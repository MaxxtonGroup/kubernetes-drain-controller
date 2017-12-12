import "rxjs";
import { Service } from "typedi";
import * as winston from "winston";
import { KubeClient } from "../clients/kube.client";
import { Node } from "../domain/kube/node.model";
import { Pod } from "../domain/kube/pod.model";
import { ReplicaController } from "../domain/kube/replica-controller.model";
import { DrainControllerService, DrainControllerStatus } from "./drain-controller.service";

/**
 * Service that watches for unschedulable and not ready nodes and drains them safely.
 */
@Service()
export class NodeService {

  private nodeStore: { [name: string]: Node } = {};
  private drainControllers: { [name: string]: DrainControllerService } = {};

  constructor(private kubeClient: KubeClient) {
  }

  public init() {
    this.watchNodes();
  }

  /**
   * Watch all nodes via the kubernetes api
   */
  private watchNodes() {
    // Get initial nodes
    this.kubeClient.getNodes()
      .subscribe(nodes => {
        nodes.forEach(node => {
          if (!this.nodeStore[node.metadata.name] ||
            this.nodeStore[node.metadata.name].spec.unschedulable !== node.spec.unschedulable) {
            if (!this.isNodeReady(node)) {
              this.drainNode(node);
            }

            // Update node in store
            this.nodeStore[node.metadata.name] = node;
          }
        });

        this.kubeClient.watchNodes()
          .subscribe(node => {
            // check if a node has updated
            if (!this.nodeStore[node.metadata.name] ||
              this.nodeStore[node.metadata.name].spec.unschedulable !== node.spec.unschedulable) {
              if (!this.isNodeReady(node)) {
                this.drainNode(node);
              }

              // Update node in store
              this.nodeStore[node.metadata.name] = node;
            }
          }, error => {
            winston.error(error);
          }, () => {
            this.watchNodes();
          });
      }, error => {
        winston.error(error);
        this.watchNodes();
      });
  }

  /**
   * Drain node
   * @param {Node} node
   */
  private drainNode(node: Node): void {
    winston.info(`drain node ${node.metadata.name}`);
    // Get pods
    this.kubeClient.getPods()
      .retry(5)
      .map(pods => pods.filter(pod => pod.spec.nodeName === node.metadata.name))
      .filter(pods => pods.length > 0)
      .subscribe(pods => {

        // Get replica-controllers
        this.kubeClient.getReplicaControllers()
          .retry(5)
          .subscribe(rcs => {

            pods.forEach(pod => {

              // Group pods by replica-controller
              const rc = this.getReplicaControllerForPod(pod, rcs);
              if (rc) {

                // Use a drain-controller to drain pods by replica-controller
                let drainController = this.drainControllers[`${rc.metadata.namespace}/${rc.metadata.name}`];
                if (!drainController) {
                  drainController = new DrainControllerService(node, rc, this.kubeClient);
                  drainController.onUpdate((dc) => this.onDrainControllerUpdate(dc.node));
                  this.drainControllers[`${rc.metadata.namespace}/${rc.metadata.name}`] = drainController;
                }
                // Register pod by the drain controller
                drainController.addPod(pod);

              } else {
                winston.warn(
                  `Pod ${pod.metadata.namespace}/${pod.metadata.name} isn't managed by a replica-controller`);
              }
            });

            Object.keys(this.drainControllers)
              .map(dcName => this.drainControllers[dcName])
              .filter(dc => dc.status === DrainControllerStatus.Pending)
              .forEach(dc => {
                dc.drainPods().then().catch(e => winston.error(e));
              });

            this.onDrainControllerUpdate(node);

          }, error => {
            winston.error(`Failed to drain node ${node.metadata.name}, unable to fetch replica-controllers`, error);
          });

      }, error => {
        winston.error(`Failed to drain node ${node.metadata.name}, unable to fetch pods`, error);
      });
  }

  private onDrainControllerUpdate(node: Node): void {
    // Get drain-controllers for this node
    const drainControllers = Object.keys(this.drainControllers)
      .map(dcName => this.drainControllers[dcName])
      .filter(dc => dc.node.metadata.name === node.metadata.name);

    const runningDrainControllers = drainControllers.filter(dc => dc.status === "Running");
    const failedDrainControllers = drainControllers.filter(dc => dc.status === "Failed");

    let totalPods = 0;
    drainControllers.forEach(dc => totalPods += dc.totalPods);

    if (runningDrainControllers.length === 0) {
      if (failedDrainControllers.length > 0) {
        winston.warn(`${node.metadata.name}: ${failedDrainControllers.length} replica-controllers are not drained:`);
        failedDrainControllers.forEach(dc => {
          winston.warn(`${node.metadata.name}: - ${dc.rc.metadata.namespace}/${dc.rc.metadata.name}`);
        });
      } else {
        winston.info(`${node.metadata.name}: ${drainControllers.length} replica-controllers are successfully drained`);
      }
    } else {
      let remainingPods = 0;
      runningDrainControllers.forEach(dc => remainingPods += dc.remainingPods);
      winston.info(`${node.metadata.name}: ${remainingPods}/${totalPods} drained`);
    }
  }

  private isNodeReady(node: Node): boolean {
    return !node.spec.unschedulable;
  }

  /**
   * Find matching replica-controller
   * @param {Pod} pod
   * @param {ReplicaController[]} rcs
   * @returns {ReplicaController}
   */
  private getReplicaControllerForPod(pod: Pod, rcs: ReplicaController[]): ReplicaController {
    const podLabels = pod.metadata.labels;
    if (podLabels) {
      const matchingRcs = rcs
        .filter(rc => rc.metadata.namespace === pod.metadata.namespace)
        .filter(rc => rc.spec.replicas === 1)
        .filter(rc => {
          const selector = rc.spec.selector;
          if (selector) {
            for (const key in selector) {
              if (selector[key] !== podLabels[key]) {
                return false;
              }
            }
            return true;
          }
          return false;
        });
      if (matchingRcs.length > 0) {
        return matchingRcs[0];
      }
    }
    return null;
  }

}
