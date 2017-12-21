import { Inject } from "typedi";
import * as winston from "winston";
import { KubeClient } from "../clients/kube.client";
import { controller } from "../config/property-keys";
import { Settings } from "../config/settings";
import { DeploymentConfigAnnotation } from "../domain/deploymentconfig-annotation.model";
import { DeploymentConfig } from "../domain/kube/deploymentconfig.model";
import { Node } from "../domain/kube/node.model";
import { Pod } from "../domain/kube/pod.model";
import { NodeAnnotation } from "../domain/node-annotation.model";

/**
 * Service responsible for draining a node
 */
export class NodeDrainService {

  public static readonly ANNOTATION_NAME = "maxxton.com/drain-controller";
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
            winston.error(`Failed to process node ${node.metadata.name}`);
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
    if (node.spec.unschedulable) {
      let nodeAnnotation = this.getNodeAnnotation(node);
      if (!nodeAnnotation.deploymentConfigs) {
        nodeAnnotation.deploymentConfigs = [];
      }
      let pods = await this.getPodsOnNode(node.metadata.name);

      // Get Deployment info per pod
      await Promise.all(pods.map(async pod => {
        let deploymentConfig = await this.getDeploymentConfigForPod(pod);
        if (deploymentConfig) {
          if (deploymentConfig.spec.replicas === 1) {
            let dcAnnotation = nodeAnnotation.deploymentConfigs.filter(dc =>
              dc.namespace === deploymentConfig.metadata.namespace && dc.name === deploymentConfig.metadata.name)[0];
            if (dcAnnotation) {
              if (dcAnnotation.pods.indexOf(pod.metadata.name) === -1) {
                dcAnnotation.pods.push(pod.metadata.name);
              }
              dcAnnotation.current = deploymentConfig.status.readyReplicas;
              dcAnnotation.desired = deploymentConfig.spec.replicas;
            } else {
              dcAnnotation = {
                namespace: deploymentConfig.metadata.namespace,
                name: deploymentConfig.metadata.name,
                pods: [pod.metadata.name],
                original: deploymentConfig.spec.replicas,
                desired: deploymentConfig.spec.replicas,
                current: deploymentConfig.status.readyReplicas
              };
              nodeAnnotation.deploymentConfigs.push(dcAnnotation);
            }
          } else {
            let dcAnnotation = nodeAnnotation.deploymentConfigs.filter(dc =>
              dc.namespace === deploymentConfig.metadata.namespace && dc.name === deploymentConfig.metadata.name)[0];
            if (dcAnnotation) {
              if (dcAnnotation.pods.indexOf(pod.metadata.name) === -1) {
                dcAnnotation.pods.push(pod.metadata.name);
              }
              dcAnnotation.current = deploymentConfig.status.readyReplicas;
              dcAnnotation.desired = deploymentConfig.spec.replicas;
            }
          }
        }
      }));
      await this.saveAnnotations(node, nodeAnnotation);

      // Process each deployment
      let removeDcs: DeploymentConfigAnnotation[] = [];
      await Promise.all(nodeAnnotation.deploymentConfigs.map(async dcAnnotation => {
        // Filter removed pods
        let podInfos = await Promise.all(dcAnnotation.pods.map(async podName => {
          let deleted = await this.isPodDeleted(dcAnnotation.namespace, podName);
          return { podName, deleted };
        }));
        podInfos
          .filter(podInfo => podInfo.deleted)
          .forEach(podInfo => {
            let index = dcAnnotation.pods.indexOf(podInfo.podName);
            if (index > -1) {
              dcAnnotation.pods.splice(index, 1);
            }
          });

        if (dcAnnotation.pods.length > 0) {
          if (!this.isScaled(dcAnnotation)) {
            await this.scaleUp(dcAnnotation);
            await this.saveAnnotations(node, nodeAnnotation);
          } else if (!this.isReady(dcAnnotation)) {
            // Do nothing and wait for all pods to be ready
          } else {
            // Register first ready time
            if (dcAnnotation.readyTime === undefined) {
              winston.info(
                `${dcAnnotation.namespace}/${dcAnnotation.name} is ready, waiting for old pods to be removed`);
              dcAnnotation.readyTime = new Date().getTime();
            }
            await this.saveAnnotations(node, nodeAnnotation);

            // Check if the original pods are deleted
            let toBeDeleted: boolean[] = (await Promise.all(dcAnnotation.pods
              .map(podName => this.isPodDeleted(dcAnnotation.namespace, podName))))
              .filter(deleted => !deleted);
            if (toBeDeleted.length > 0) {
              // Wait for pods to be deleted or kill it after a grace period
              if (this.passedGracePeriod(dcAnnotation)) {
                await Promise.all(
                  dcAnnotation.pods.map(podName => this.deletePod(dcAnnotation.namespace, podName)));
              }
            } else {
              await this.scaleDown(dcAnnotation);
              // Remove annotation for this deployment-config
              removeDcs.push(dcAnnotation);
            }
          }
        } else {
          await this.scaleDown(dcAnnotation);
          // Remove annotation for this deployment-config
          removeDcs.push(dcAnnotation);
        }
      }));
      if (removeDcs.length > 0) {
        removeDcs.forEach(dcAnnotation => {
          let index = nodeAnnotation.deploymentConfigs.indexOf(dcAnnotation);
          if (index > -1) {
            nodeAnnotation.deploymentConfigs.splice(index, 1);
          }
        });
        await this.saveAnnotations(node, nodeAnnotation);
        if (nodeAnnotation.deploymentConfigs.length > 0) {
          winston.info(
            `Node ${node.metadata.name} ${nodeAnnotation.deploymentConfigs.length} deployments remaining...`);
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
   * @param {DeploymentConfigAnnotation} dcAnnotation
   * @returns {boolean}
   */
  private passedGracePeriod(dcAnnotation: DeploymentConfigAnnotation): boolean {
    if (dcAnnotation.readyTime !== undefined) {
      return new Date().getTime() - this.GRACE_PERIOD > dcAnnotation.readyTime;
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
   * Get Deployment Config for a pod
   * @param {Pod} pod
   * @returns {Promise<DeploymentConfig>}
   */
  private async getDeploymentConfigForPod(pod: Pod): Promise<DeploymentConfig> {
    if (pod.metadata.annotations && pod.metadata.annotations["openshift.io/deployment-config.name"]) {
      let dcName = pod.metadata.annotations["openshift.io/deployment-config.name"];
      try {
        return await this.kubeClient.getDeploymentConfig(pod.metadata.namespace, dcName).toPromise();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * Check if deployment-config is ready
   * @param {DeploymentConfigAnnotation} dcAnnotation
   * @returns {boolean}
   */
  private isReady(dcAnnotation: DeploymentConfigAnnotation): boolean {
    return dcAnnotation.current === dcAnnotation.desired;
  }

  /**
   * Check if deployment-config is scaled
   * @param {DeploymentConfigAnnotation} dcAnnotation
   * @returns {boolean}
   */
  private isScaled(dcAnnotation: DeploymentConfigAnnotation): boolean {
    return dcAnnotation.original + 1 === dcAnnotation.desired;
  }

  /**
   * Scale up deployment-configs
   * @param {DeploymentConfigAnnotation} dcAnnotation
   * @returns {Promise<DeploymentConfig>}
   */
  private async scaleUp(dcAnnotation: DeploymentConfigAnnotation): Promise<DeploymentConfig> {
    dcAnnotation.desired = dcAnnotation.original + 1;
    winston.info(`Scale up ${dcAnnotation.namespace}/${dcAnnotation.name} to ${dcAnnotation.desired}`);
    return this.kubeClient.scaleDeploymentConfig(dcAnnotation.namespace, dcAnnotation.name, dcAnnotation.desired)
      .toPromise();
  }

  /**
   * Scale down deployment-configs
   * @param {DeploymentConfigAnnotation} dcAnnotation
   * @returns {Promise<DeploymentConfig>}
   */
  private async scaleDown(dcAnnotation: DeploymentConfigAnnotation): Promise<DeploymentConfig> {
    dcAnnotation.desired = dcAnnotation.original;
    winston.info(`Scale down ${dcAnnotation.namespace}/${dcAnnotation.name} to ${dcAnnotation.desired}`);
    return this.kubeClient.scaleDeploymentConfig(dcAnnotation.namespace, dcAnnotation.name, dcAnnotation.desired)
      .toPromise();
  }

  /**
   * Scale down all deployment-configs to original replicas on a node
   * @param {Node} node
   * @returns {Promise<void>}
   */
  private async scaleDownNode(node: Node): Promise<void> {
    let nodeAnnotation = this.getNodeAnnotation(node);
    if (nodeAnnotation.deploymentConfigs) {
      let promises = nodeAnnotation.deploymentConfigs
        .map(dc => {
          dc.desired = dc.original;
          winston.info(`Scale down ${dc.namespace}/${dc.name} to ${dc.original}`);
          return this.kubeClient.scaleDeploymentConfig(dc.namespace, dc.name, dc.original).toPromise();
        });
      await Promise.all(promises);
    }
    nodeAnnotation.deploymentConfigs = [];
    await this.saveAnnotations(node, nodeAnnotation);
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
