import * as request from "request";
import { Observable } from "rxjs";
import { Service } from "typedi";
import { Watch } from "../domain/kube/api.model";
import { DeploymentConfig } from "../domain/kube/deploymentconfig.model";
import { Node } from "../domain/kube/node.model";
import { Pod } from "../domain/kube/pod.model";
import { ReplicaController } from "../domain/kube/replica-controller.model";

/**
 * Kubernetes API client
 */
@Service()
export abstract class KubeClient {

  /**
   * Get or watch resource
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public get<T>(uri: string, options?: request.CoreOptions): Observable<T> {
    return this.request<T>("get", uri, options);
  }

  /**
   * Delete a resource
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public delete(uri: string): Observable<void> {
    return this.request<any>("delete", uri);
  }

  /**
   * Edit a resource
   * @param {string} uri
   * @param resource
   * @returns {Observable<any>}
   */
  public put<T>(uri: string, resource: any): Observable<T> {
    return this.request<T>("put", uri, { body: resource });
  }

  /**
   * Patch a resource
   * @param {string} uri
   * @param patchObject
   * @returns {Observable<T>}
   */
  public patch<T>(uri: string, patchObject: any): Observable<T> {
    return this.request<T>("patch", uri,
      {
        json: false,
        body: JSON.stringify(patchObject),
        headers: { "Content-Type": "application/merge-patch+json" }
      });
  }

  /**
   * Get or watch resource
   * @param method
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public abstract request<T>(method: string, uri: string, options?: request.CoreOptions): Observable<T>;

  /**
   * Get List of resources
   * @param {string} uri
   * @param {RequestOptions} options
   * @returns {Observable<T[]>}
   */
  public getList<T>(uri: string, options?: request.CoreOptions): Observable<T[]> {
    return this.get<any>(uri, options)
      .map(list => list.items as T[]);
  }

  /**
   * Watch resource(s)
   * @param {string} uri
   * @param {RequestOptions} options
   * @returns {Observable<T>}
   */
  public getWatch<T>(uri: string, options?: request.CoreOptions): Observable<T> {
    let o: request.CoreOptions = options || {};
    if (!o.qs) {
      o.qs = {};
    }
    o.qs.watch = "true";
    return this.get<Watch<any>>(uri, o)
      .map(watch => watch.object);
  }

  /**
   * Get nodes
   * @returns {Observable<Node[]>}
   */
  public getNodes(options?: request.CoreOptions): Observable<Node[]> {
    return this.getList("/api/v1/nodes", options);
  }

  /**
   * Watch nodes
   * @returns {Observable<Node>}
   */
  public watchNodes(options?: request.CoreOptions): Observable<Watch<Node>> {
    return this.getWatch("/api/v1/nodes", options);
  }

  /**
   * Get node
   * @param {string} name
   * @param {request.CoreOptions} options
   * @returns {Observable<Node>}
   */
  public getNode(name: string, options?: request.CoreOptions): Observable<Node> {
    return this.get(`/api/v1/nodes/${name}`, options);
  }

  /**
   * Patch node
   * @param {Node} node
   * @param {request.CoreOptions} options
   * @returns {Observable<Node>}
   */
  public patchNode(name: string, node: Node, options?: request.CoreOptions): Observable<Node> {
    return this.patch(`/api/v1/nodes/${name}`, node);
  }

  /**
   * Update node
   * @param {Node} node
   * @param {request.CoreOptions} options
   * @returns {Observable<Node>}
   */
  public putNode(node: Node, options?: request.CoreOptions): Observable<Node> {
    return this.put(`/api/v1/nodes/${node.metadata.name}`, node);
  }

  /**
   * Get all pods
   * @returns {Observable<Pod[]>}
   */
  public getPods(options?: request.CoreOptions): Observable<Pod[]> {
    return this.getList("/api/v1/pods", options);
  }

  /**
   * Get a pod
   * @returns {Observable<Pod>}
   */
  public getPod(namespace: string, name: string): Observable<Pod> {
    return this.get<any>(`/api/v1/namespaces/${namespace}/pods/${name}`);
  }

  /**
   * Delete a pod
   * @returns {Observable<Pod>}
   */
  public deletePod(namespace: string, name: string): Observable<void> {
    return this.delete(`/api/v1/namespaces/${namespace}/pods/${name}`);
  }

  /**
   * Get all pods
   * @returns {Observable<Pod[]>}
   */
  public watchPod(namespace: string, name: string): Observable<Pod> {
    return this.getWatch<any>(`/api/v1/namespaces/${namespace}/pods/${name}`);
  }

  /**
   * Get a replica-controller
   * @returns {Observable<ReplicaController>}
   */
  public getReplicaController(namespace: string, name: string): Observable<ReplicaController> {
    return this.get<any>(`/api/v1/namespaces/${namespace}/replicationcontrollers/${name}`);
  }

  /**
   * Get all replica-controllers
   * @param {string} namespace
   * @returns {Observable<ReplicaController[]>}
   */
  public getReplicaControllers(namespace: string): Observable<ReplicaController[]> {
    return this.getList<any>("/api/v1/namespaces/${namespace}/replicationcontrollers");
  }

  /**
   * Get all replica-controllers
   * @returns {Observable<ReplicaController[]>}
   */
  public getAllReplicaControllers(): Observable<ReplicaController[]> {
    return this.getList<any>("/api/v1/replicationcontrollers");
  }

  /**
   * Get deployment-config
   * @param {string} namespace
   * @param {string} name
   * @returns {Observable<DeploymentConfig>}
   */
  public getDeploymentConfig(namespace: string, name: string): Observable<DeploymentConfig> {
    return this.get(`/oapi/v1/namespaces/${namespace}/deploymentconfigs/${name}`);
  }

  /**
   * Scale the replicas of a replica-controller
   * @param {string} namespace
   * @param {string} rcName
   * @param {number} replicas
   * @returns {Observable<ReplicaController>}
   */
  public scaleReplicaControllers(namespace: string, rcName: string, replicas: number): Observable<ReplicaController> {
    return Observable.create(observer => {
      let url = `/api/v1/namespaces/${namespace}/replicationcontrollers/${rcName}/scale`;
      this.get<ReplicaController>(url)
        .subscribe(rc => {
          if (!rc.spec) {
            rc.spec = {};
          }
          rc.spec.replicas = replicas;
          this.put<ReplicaController>(url, rc)
            .subscribe(rc2 => {
              observer.next(rc2);
              observer.complete();
            }, error => observer.error(error));
        }, error => observer.error(error));
    });
  }

  /**
   * Scale the replicas of a deployment-config
   * @param {string} namespace
   * @param {string} dcName
   * @param {number} replicas
   * @returns {Observable<DeploymentConfig>}
   */
  public scaleDeploymentConfig(namespace: string, dcName: string, replicas: number): Observable<DeploymentConfig> {
    return Observable.create(observer => {
      let url = `/oapi/v1/namespaces/${namespace}/deploymentconfigs/${dcName}/scale`;
      this.get<DeploymentConfig>(url)
        .subscribe(rc => {
          if (!rc.spec) {
            rc.spec = {};
          }
          rc.spec.replicas = replicas;
          this.put<ReplicaController>(url, rc)
            .subscribe(rc2 => {
              observer.next(rc2);
              observer.complete();
            }, error => observer.error(error));
        }, error => observer.error(error));
    });
  }

}
