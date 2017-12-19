import "rxjs/add/observable/forkJoin";
import { Observable } from "rxjs/Observable";
import { Service } from "typedi";
import * as winston from "winston";
import { KubeClient } from "../clients/kube.client";
import { Node } from "../domain/kube/node.model";
import { Pod } from "../domain/kube/pod.model";
import { ReplicaController } from "../domain/kube/replica-controller.model";

/**
 * Service responsible for draining pods per replica-controller
 */
@Service()
export class DrainControllerService {

  private _pods: Pod[] = [];
  private _node: Node;
  private _rc: ReplicaController;
  private _originalReplicas;
  private _status: DrainControllerStatus = DrainControllerStatus.Pending;
  private _totalPods: number;
  private _remainingPods: number;
  private callbacks: Array<(dc: DrainControllerService) => void> = [];

  private pollInterval = 1000;
  private gracePeriod = 300000; // 5 minutes

  constructor(node: Node, rc: ReplicaController, private kubeClient: KubeClient) {
    this._node = node;
    this._rc = rc;
    this._originalReplicas = rc.spec.replicas;
  }

  get pods(): Pod[] {
    return this._pods;
  }

  get node(): Node {
    return this._node;
  }

  get rc(): ReplicaController {
    return this._rc;
  }

  get status(): DrainControllerStatus {
    return this._status;
  }

  get totalPods(): number {
    return this._totalPods;
  }

  get remainingPods() {
    return this._remainingPods;
  }

  public addPod(pod: Pod): void {
    this._pods.push(pod);
    this._totalPods++;
    this._remainingPods++;
    this._status = DrainControllerStatus.Pending;
  }

  /**
   * Register callback for onUpdate
   * @param {(dc: DrainControllerService) => void} callback
   */
  public onUpdate(callback: ((dc: DrainControllerService) => void)): void {
    this.callbacks.push(callback);
  }

  /**
   * Drain pods from node
   * @returns {Promise<void>}
   */
  public async drainPods(): Promise<void> {
    this._status = DrainControllerStatus.Running;
    winston.info(`drain replica-controller ${this.rc.metadata.namespace}/${this.rc.metadata.name}`);
    try {
      await this.scaleUp();
      await this.waitScaleUp();
      await this.waitForPodDeleted();
      await this.scaleDown();
      winston.info(`drain complete replica-controller ${this.rc.metadata.namespace}/${this.rc.metadata.name}`);
      this._status = DrainControllerStatus.Done;

    } catch (e) {
      winston.error(`drain failed for replica-controller ${this.rc.metadata.namespace}/${this.rc.metadata.name}`, e);
      this._status = DrainControllerStatus.Failed;
      throw e;

    } finally {
      this.callbacks.forEach(cb => cb(this));
    }
  }

  /**
   * Scaleup replica-controller by 1 instance
   * @returns {Observable<any>}
   */
  private scaleUp(): Promise<any> {
    let newReplicas = this._originalReplicas + 1;
    winston.info(`Scale rc ${this.rc.metadata.namespace}/${this.rc.metadata.name} to ${newReplicas}`);
    if (this.rc.metadata.annotations && this.rc.metadata.annotations["openshift.io/deployment-config.name"]) {
      return this.kubeClient.scaleDeploymentConfig(this.rc.metadata.namespace,
        this.rc.metadata.annotations["openshift.io/deployment-config.name"], newReplicas)
        .retry(3).toPromise();
    } else {
      return this.kubeClient.scaleReplicaControllers(this.rc.metadata.namespace, this.rc.metadata.name, newReplicas)
        .retry(3).toPromise();
    }
  }

  /**
   * Wait for the replica-controller to scale up to at least 2 instances
   * @returns {Promise<any>}
   */
  private waitScaleUp(): Promise<any> {
    return new Promise((resolve, reject) => {
      let checkScaleStatus = () => {
        this.kubeClient.getReplicaController(this.rc.metadata.namespace, this.rc.metadata.name)
          .subscribe(rc => {
            if (rc.status.readyReplicas >= 2) {
              resolve();
            }
          }, error => {
            winston.error(error);
            setTimeout(() => checkScaleStatus(), this.pollInterval);
          });
      };
    });

  }

  /**
   * Scale down replica-controller to original replicas
   * @returns {Promise<any>}
   */
  private scaleDown(): Promise<any> {
    let newReplicas = this._originalReplicas;
    winston.info(`Scale rc ${this.rc.metadata.namespace}/${this.rc.metadata.name} to ${newReplicas}`);
    if (this.rc.metadata.annotations && this.rc.metadata.annotations["openshift.io/deployment-config.name"]) {
      return this.kubeClient.scaleDeploymentConfig(this.rc.metadata.namespace,
        this.rc.metadata.annotations["openshift.io/deployment-config.name"], newReplicas)
        .retry(3).toPromise();
    } else {
      return this.kubeClient.scaleReplicaControllers(this.rc.metadata.namespace, this.rc.metadata.name, newReplicas)
        .retry(3).toPromise();
    }
  }

  /**
   * Wait for the pods to be deleted.
   * If it is not deleted within the grace period, it will be removed with force.
   * @returns {Promise<any>}
   */
  private waitForPodDeleted(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Watch pods for deletes
      let checkPodExists = () => {
        let podsExists = this.pods.map(pod => {
          return { name: pod.metadata.name, namespace: pod.metadata.namespace };
        });

        Promise.all(this.pods.map(pod => {
          return new Promise((res, rej) => {
            this.kubeClient.getPod(pod.metadata.namespace, pod.metadata.name)
              .subscribe(p => {
                if (p.status.phase !== "Running") {
                  res();
                } else {
                  rej();
                }
              }, error => {
                winston.warn(error);
                res();
              });
          });
        })).then(() => {
          this._remainingPods = 0;
          resolve();
        }, error => {
          setTimeout(() => checkPodExists(), this.pollInterval);
        });
      };

      // Forced delete the pod after a grace period
      let deleteAfterGracePeriod = () => {
        setTimeout(() => {
          this.pods.forEach(pod => {
            this.kubeClient.getPod(pod.metadata.namespace, pod.metadata.name)
              .subscribe(() => {
                // Pod still exists
                winston.warn(`Delete pod ${pod.metadata.namespace}/${pod.metadata.namespace} ` +
                  `from node ${this.node.metadata.name}`);
                this.kubeClient.deletePod(pod.metadata.namespace, pod.metadata.name)
                  .subscribe(() => {
                    // done
                  }, error => {
                    // Log and retry
                    winston.error(error);
                    deleteAfterGracePeriod();
                  });
              }, error => {
                winston.warn(error);
                resolve();
              });
          });
        }, this.gracePeriod);
      };
      deleteAfterGracePeriod();
    });
  }
}

export enum DrainControllerStatus {

  Pending = "Pending",
  Running = "Running",
  Failed = "Failed",
  Done = "Done"

}
