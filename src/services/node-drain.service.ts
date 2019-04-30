import { Inject } from "typedi";
import * as winston from "winston";
import { KubeClient } from "../clients/kube.client";
import { controller } from "../config/property-keys";
import { Settings } from "../config/settings";
import { ControllerAnnotation } from "../domain/controller-annotation.model";
import { ApiModel } from "../domain/kube/api.model";
import { DeploymentConfig } from "../domain/kube/deploymentconfig.model";
import { Node } from "../domain/kube/node.model";
import { PodDisruptionBudgetModel } from "../domain/kube/pod-disruption-budget.model";
import { Pod } from "../domain/kube/pod.model";
import { NodeAnnotation } from "../domain/node-annotation.model";

/**
 * Service responsible for draining a node
 */
export class NodeDrainService {

  public static readonly ANNOTATION_NAME = "com.maxxton/drain-controller";
  private readonly POLL_PERIOD: number;
  private readonly GRACE_PERIOD: number;

  constructor(@Inject("kube-client") private kubeClient: KubeClient) {
    this.GRACE_PERIOD = Settings.get(controller.grace_period, 5 * 60) * 1000;
    this.POLL_PERIOD = Settings.get(controller.poll_period, 10) * 1000;
  }

  /**
   * Setup watching all nodes
   */
  public init(): void {
    setInterval(() => {
      (async () => {
        let nodes = await this.kubeClient.getNodes().toPromise();
        await Promise.all(nodes.map(async node => {
          try {
            await this.processNode(node);
          } catch (e) {
            winston.error(`Failed to process node ${node.metadata.name}`, e);
          }
        }));
      })().then().catch(e => winston.error(e));
    }, this.POLL_PERIOD);
  }

  /**
   * Process a node
   * @param {Node} node
   * @returns {Promise<void>}
   */
  public async processNode(node: Node): Promise<void> {
    let cache = {};
    if (node.spec.unschedulable) {
      let nodeAnnotation = this.getNodeAnnotation(node);
      if (!nodeAnnotation.controllers) {
        nodeAnnotation.controllers = [];
      }
      let pods = await this.getPodsOnNode(node.metadata.name);

      // Get Controller info per pod
      await Promise.all(pods.map(async pod => {
        let podDisruptionBudget = await this.findPodDisruptionBudget(pod, cache);
        if (podDisruptionBudget && podDisruptionBudget.spec && podDisruptionBudget.spec.minAvailable === 1) {

          let ownerController = await this.findOwnerController(pod, cache);
          if (ownerController) {
            let ownerResourceName = await this.kubeClient.getResourceNameForKind(ownerController.apiVersion,
              ownerController.kind, { cache }).toPromise();
            // Supported controllers: Deployment and DeploymentConfig
            if (ownerController.kind === "Deployment" || ownerController.kind === "DeploymentConfig") {

              if (ownerController.spec.replicas === 1) {
                let controllerAnnotation = nodeAnnotation.controllers.find(controller =>
                  controller.namespace === ownerController.metadata.namespace && controller.name === ownerController.metadata.name &&
                  controller.apiVersion === ownerController.apiVersion && controller.kind === ownerController.apiVersion);
                if (controllerAnnotation) {
                  if (controllerAnnotation.pods.indexOf(pod.metadata.name) === -1) {
                    controllerAnnotation.pods.push(pod.metadata.name);
                  }
                  controllerAnnotation.current = ownerController.status.readyReplicas;
                  controllerAnnotation.desired = ownerController.spec.replicas;
                } else {
                  controllerAnnotation = {
                    kind: ownerController.kind,
                    resourceName: ownerResourceName,
                    apiVersion: ownerController.apiVersion,
                    namespace: ownerController.metadata.namespace,
                    name: ownerController.metadata.name,
                    pods: [pod.metadata.name],
                    original: ownerController.spec.replicas,
                    desired: ownerController.spec.replicas,
                    current: ownerController.status.readyReplicas
                  };
                  nodeAnnotation.controllers.push(controllerAnnotation);
                }
              } else {
                let controllerAnnotation = nodeAnnotation.controllers.find(controller =>
                  controller.namespace === ownerController.metadata.namespace && controller.name === ownerController.metadata.name &&
                  controller.apiVersion === ownerController.apiVersion && controller.kind === ownerController.apiVersion);
                if (controllerAnnotation) {
                  if (controllerAnnotation.pods.indexOf(pod.metadata.name) === -1) {
                    controllerAnnotation.pods.push(pod.metadata.name);
                  }
                  controllerAnnotation.current = ownerController.status.readyReplicas;
                  controllerAnnotation.desired = ownerController.spec.replicas;
                }
              }
            }
          }
        }
      }));
      await this.saveAnnotations(node, nodeAnnotation);

      // Process each controller
      let removeControllers: ControllerAnnotation[] = [];
      await Promise.all(nodeAnnotation.controllers.map(async controllerAnnotation => {
        // Filter removed pods
        let podInfos = await Promise.all(controllerAnnotation.pods.map(async podName => {
          let deleted = await this.isPodDeleted(controllerAnnotation.namespace, podName);
          return { podName, deleted };
        }));
        podInfos
          .filter(podInfo => podInfo.deleted)
          .forEach(podInfo => {
            let index = controllerAnnotation.pods.indexOf(podInfo.podName);
            if (index > -1) {
              controllerAnnotation.pods.splice(index, 1);
            }
          });

        if (controllerAnnotation.pods.length > 0) {
          if (!this.isScaled(controllerAnnotation)) {
            await this.scaleUp(controllerAnnotation);
            await this.saveAnnotations(node, nodeAnnotation);
          } else if (!this.isReady(controllerAnnotation)) {
            // Do nothing and wait for all pods to be ready
          } else {
            // Register first ready time
            if (controllerAnnotation.readyTime === undefined) {
              winston.info(
                `${controllerAnnotation.namespace}/${controllerAnnotation.name} is ready, waiting for old pods to be removed`);
              controllerAnnotation.readyTime = new Date().getTime();
            }
            await this.saveAnnotations(node, nodeAnnotation);

            // Check if the original pods are deleted
            let toBeDeleted: boolean[] = (await Promise.all(controllerAnnotation.pods
              .map(podName => this.isPodDeleted(controllerAnnotation.namespace, podName))))
              .filter(deleted => !deleted);
            if (toBeDeleted.length > 0) {
              // Wait for pods to be deleted or kill it after a grace period
              if (this.passedGracePeriod(controllerAnnotation)) {
                await Promise.all(
                  controllerAnnotation.pods.map(podName => this.deletePod(controllerAnnotation.namespace, podName)));
              }
            } else {
              await this.scaleDown(controllerAnnotation);
              // Remove annotation for this deployment-config
              removeControllers.push(controllerAnnotation);
            }
          }
        } else {
          await this.scaleDown(controllerAnnotation);
          // Remove annotation for this deployment-config
          removeControllers.push(controllerAnnotation);
        }
      }));
      if (removeControllers.length > 0) {
        removeControllers.forEach(controllerAnnotation => {
          let index = nodeAnnotation.controllers.indexOf(controllerAnnotation);
          if (index > -1) {
            nodeAnnotation.controllers.splice(index, 1);
          }
        });
        await this.saveAnnotations(node, nodeAnnotation);
        if (nodeAnnotation.controllers.length > 0) {
          winston.info(
            `Node ${node.metadata.name} ${nodeAnnotation.controllers.length} deployments remaining...`);
        } else {
          winston.info(`Node ${node.metadata.name} is drained!`);
        }
      }

    } else {
      await this.scaleDownNode(node);
    }
  }

  /**
   * Check if pod is deleted
   * @param {string} podName
   * @param {string} namespace
   * @returns {Promise<boolean>}
   */
  private async isPodDeleted(namespace: string, podName: string): Promise<boolean> {
    try {
      let pod = await this.kubeClient.getPod(namespace, podName).toPromise();
      if (pod.status.phase !== "Running") {
        return true;
      }
    } catch (e) {
      if (e.statusCode === 404) {
        return true;
      }
    }
    return false;
  }

  /**
   * Delete Pod
   * @param {string} podName
   * @param {string} namespace
   * @returns {Promise<void>}
   */
  private async deletePod(namespace: string, podName: string): Promise<void> {
    winston.info(`Delete pod ${namespace}/${podName}`);
    return this.kubeClient.deletePod(namespace, podName).toPromise();
  }

  /**
   * Check if pods have passed the grace period
   * @param {DeploymentConfigAnnotation} controllerAnnotation
   * @returns {boolean}
   */
  private passedGracePeriod(controllerAnnotation: ControllerAnnotation): boolean {
    if (controllerAnnotation.readyTime !== undefined) {
      return new Date().getTime() - this.GRACE_PERIOD > controllerAnnotation.readyTime;
    }
    return false;
  }

  /**
   * Save node annotations
   * @param {Node} node
   * @param {NodeAnnotation} annotation
   * @returns {Promise<void>}
   */
  private async saveAnnotations(node: Node, annotation: NodeAnnotation): Promise<void> {
    for (let i = 0; i < 10; i++) {
      try {
        let patch: any = {
          metadata: {
            annotations: {}
          }
        };
        patch.metadata.annotations[NodeDrainService.ANNOTATION_NAME] = JSON.stringify(annotation);

        await this.kubeClient.patchNode(node.metadata.name, patch).toPromise();
        break;
      } catch (e) {
        winston.error(`Failed to patch node ${node.metadata.name}`, e);
      }
    }
  }

  /**
   * Get Pods on a node
   * @param {string} nodeName
   * @returns {Promise<Pod[]>}
   */
  private async getPodsOnNode(nodeName: string): Promise<Pod[]> {
    return this.kubeClient.getPods({
      qs: {
        fieldSelector: `spec.nodeName=${nodeName}`
      }
    }).toPromise();
  }

  /**
   * Find Pod disruption budget that matches the pod
   * @param pod
   * @param cache
   */
  private async findPodDisruptionBudget(pod: Pod, cache: any): Promise<PodDisruptionBudgetModel | undefined> {
    if (pod && pod.metadata && pod.metadata.labels && pod.metadata.namespace) {
      let podDisruptionBudgets = await this.kubeClient.getPodDisruptionBudgets(pod.metadata.namespace, { cache })
        .toPromise();
      return podDisruptionBudgets.find(podDisruptionBudget => {
        if (podDisruptionBudget.spec && podDisruptionBudget.spec.selector && podDisruptionBudget.spec.selector.matchLabels) {
          let match = true;
          for (let key in podDisruptionBudget.spec.selector.matchLabels) {
            if (podDisruptionBudget.spec.selector.matchLabels[key]) {
              let value = podDisruptionBudget.spec.selector.matchLabels[key];
              if (pod.metadata.labels[key] !== value) {
                match = false;
              }
            }
          }
          return match;
        }
        return false;
      });
    }
    return undefined;
  }

  /**
   * Use ownerReferences to find the controller that manage this resource
   * @param apiModel
   */
  private async findOwnerController(apiModel: ApiModel<any, any>, cache: any): Promise<ApiModel<any, any> | undefined> {
    if (apiModel && apiModel.metadata && apiModel.metadata.ownerReferences) {
      let ownerController = apiModel.metadata.ownerReferences.find(ref => ref.controller);
      if (ownerController) {
        let resourceName = await this.kubeClient.getResourceNameForKind(ownerController.apiVersion,
          ownerController.kind, { cache }).toPromise();
        if (!resourceName) {
          winston.warn(`Could not find resourceName of ${ownerController.apiVersion} ${ownerController.kind}`);
          return undefined;
        }
        let apiVersion = ownerController.apiVersion === "v1" ? "/api/v1" : `/apis/${ownerController.apiVersion}`;
        let url = `${apiVersion}/namespaces/${apiModel.metadata.namespace}/${resourceName}/${ownerController.name}`;

        let ownerResource = await this.kubeClient.get(url).toPromise() as any;
        // Check if the owner has also an owner
        let superOwnerResource = await this.findOwnerController(ownerResource, cache);
        return superOwnerResource || ownerResource;
      }
    }
    return undefined;
  }

  /**
   * Check if deployment-config is ready
   * @param {DeploymentConfigAnnotation} controllerAnnotation
   * @returns {boolean}
   */
  private isReady(controllerAnnotation: ControllerAnnotation): boolean {
    return controllerAnnotation.current === controllerAnnotation.desired;
  }

  /**
   * Check if deployment-config is scaled
   * @param {DeploymentConfigAnnotation} controllerAnnotation
   * @returns {boolean}
   */
  private isScaled(controllerAnnotation: ControllerAnnotation): boolean {
    return controllerAnnotation.original + 1 === controllerAnnotation.desired;
  }

  /**
   * Scale up deployment-configs
   * @param {DeploymentConfigAnnotation} controllerAnnotation
   * @returns {Promise<DeploymentConfig>}
   */
  private async scaleUp(controllerAnnotation: ControllerAnnotation): Promise<DeploymentConfig> {
    controllerAnnotation.desired = controllerAnnotation.original + 1;
    winston.info(
      `Scale up ${controllerAnnotation.namespace}/${controllerAnnotation.name} to ${controllerAnnotation.desired}`);
    return this.kubeClient.scaleController(controllerAnnotation.apiVersion, controllerAnnotation.resourceName,
      controllerAnnotation.namespace, controllerAnnotation.name, controllerAnnotation.desired).toPromise();
  }

  /**
   * Scale down deployment-configs
   * @param {DeploymentConfigAnnotation} controllerAnnotation
   * @returns {Promise<DeploymentConfig>}
   */
  private async scaleDown(controllerAnnotation: ControllerAnnotation): Promise<ApiModel<any, any>> {
    controllerAnnotation.desired = controllerAnnotation.original;
    winston.info(
      `Scale down ${controllerAnnotation.namespace}/${controllerAnnotation.name} to ${controllerAnnotation.desired}`);
    return this.kubeClient.scaleController(controllerAnnotation.apiVersion, controllerAnnotation.resourceName,
      controllerAnnotation.namespace, controllerAnnotation.name, controllerAnnotation.desired).toPromise();
  }

  /**
   * Scale down all deployment-configs to original replicas on a node
   * @param {Node} node
   * @returns {Promise<void>}
   */
  private async scaleDownNode(node: Node): Promise<void> {
    let nodeAnnotation = this.getNodeAnnotation(node);
    if (nodeAnnotation.controllers && nodeAnnotation.controllers.length > 0) {
      let promises = nodeAnnotation.controllers
        .map(controllerAnnotation => {
          controllerAnnotation.desired = controllerAnnotation.original;
          winston.info(
            `Scale down ${controllerAnnotation.kind} ${controllerAnnotation.namespace}/${controllerAnnotation.name} to ${controllerAnnotation.original}`);
          return this.kubeClient.scaleController(controllerAnnotation.apiVersion, controllerAnnotation.resourceName,
            controllerAnnotation.namespace, controllerAnnotation.name, controllerAnnotation.original).toPromise();
        });
      await Promise.all(promises);
      nodeAnnotation.controllers = [];
      await this.saveAnnotations(node, nodeAnnotation);
    }
  }

  /**
   * Get metadata from annotation
   * @param {Node} node
   * @returns {NodeAnnotation}
   */
  private getNodeAnnotation(node: Node): NodeAnnotation {
    if (node.metadata.annotations && node.metadata.annotations[NodeDrainService.ANNOTATION_NAME]) {
      try {
        return JSON.parse(node.metadata.annotations[NodeDrainService.ANNOTATION_NAME]);
      } catch (e) {
        winston.error(e, "Invalid JSON in annotation " + NodeDrainService.ANNOTATION_NAME);
      }
    }
    return {};
  }

}
