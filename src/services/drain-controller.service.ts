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

  public onUpdate(callback: ((dc: DrainControllerService) => void)): void {
    this.callbacks.push(callback);
  }

  public async drainPods(): Promise<void> {
    this._status = DrainControllerStatus.Running;
    winston.info(`drain replica-controller ${this.rc.metadata.namespace}/${this.rc.metadata.name}`);
    try {
      await this.scaleUp().toPromise();
      await this.waitForPodDeleted();
      await this.scaleDown().toPromise();
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

  private scaleUp(): Observable<any> {
    let newReplicas = this._originalReplicas + 1;
    winston.info(`Scale rc ${this.rc.metadata.namespace}/${this.rc.metadata.name} to ${newReplicas}`);
    if (this.rc.metadata.annotations && this.rc.metadata.annotations["openshift.io/deployment-config.name"]) {
      return this.kubeClient.scaleDeploymentConfig(this.rc.metadata.namespace,
        this.rc.metadata.annotations["openshift.io/deployment-config.name"], newReplicas)
        .retry(3);
    } else {
      return this.kubeClient.scaleReplicaControllers(this.rc.metadata.namespace, this.rc.metadata.name, newReplicas)
        .retry(3);
    }
  }

  private scaleDown(): Observable<any> {
    let newReplicas = this._originalReplicas;
    winston.info(`Scale rc ${this.rc.metadata.namespace}/${this.rc.metadata.name} to ${newReplicas}`);
    if (this.rc.metadata.annotations && this.rc.metadata.annotations["openshift.io/deployment-config.name"]) {
      return this.kubeClient.scaleDeploymentConfig(this.rc.metadata.namespace,
        this.rc.metadata.annotations["openshift.io/deployment-config.name"], newReplicas)
        .retry(3);
    } else {
      return this.kubeClient.scaleReplicaControllers(this.rc.metadata.namespace, this.rc.metadata.name, newReplicas)
        .retry(3);
    }
  }

  private waitForPodDeleted(): Promise<any> {
    let promises: Array<Promise<Pod>> = this.pods.map(pod => {
      return new Promise((resolve, reject) => {
        this.kubeClient.watchPod(pod.metadata.namespace, pod.metadata.name)
          .filter(update => {
            return update.type && update.type === "DELETED";
          })
          .subscribe(update => {
            resolve(update.object);
          }, error => reject(error));
      });
    });
    return Promise.all(promises);
  }

}

export enum DrainControllerStatus {

  Pending = "Pending",
  Running = "Running",
  Failed = "Failed",
  Done = "Done"

}
