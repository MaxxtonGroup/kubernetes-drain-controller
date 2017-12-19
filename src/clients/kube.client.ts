import * as JSONStream from "json-stream";
import * as request from "request";
import { Observable } from "rxjs";
import { Service } from "typedi";
import * as winston from "winston";
import { KubeConfig } from "../config/kube.config";
import { Watch } from "../domain/kube/api.model";
import { Node } from "../domain/kube/node.model";
import { Pod } from "../domain/kube/pod.model";
import { ReplicaController } from "../domain/kube/replica-controller.model";

/**
 * Kubernetes API client
 */
@Service()
export class KubeClient {

  private requestOptions: request.CoreOptions;

  constructor(kubeConfig: KubeConfig) {
    this.requestOptions = kubeConfig.getRequestOptions();
  }

  /**
   * Get or watch resource
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public get<T>(uri: string, options?: { watch?: boolean }): Observable<T> {
    return this.request<T>("get", uri, options);
  }

  /**
   * Delete a resource
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public delete<T>(uri: string, options?: {}): Observable<T> {
    return this.request<T>("delete", uri, options);
  }

  /**
   * Get or watch resource
   * @param method
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public request<T>(method: string, uri: string, options?: { watch?: boolean }): Observable<T> {
    return Observable.create(observer => {
      let url = `${uri}?${options && options.watch ? "watch" : ""}`;
      winston.debug(`${method} ${url}`);

      const jsonStream = new JSONStream();
      request[method](url, this.requestOptions)
        .on("response", response => {
          if (response.statusCode >= 400) {
            observer.error("Kubernetes responded with status " + response.statusCode + " " + response.statusMessage);
          }
        }).on("end", () => {
        winston.debug(`Done GET ${url}`);
        observer.complete();
      })
        .on("error", error => {
          winston.error(`Error GET ${url}`, error);
          observer.error(error);
        })
        .pipe(jsonStream);

      jsonStream.on("data", object => {
        observer.next(object);
      }).on("error", (error) => {
        winston.error(`Error GET ${url}`, error);
        observer.error(error);
      });
    });
  }

  /**
   * Update a resource
   * @param {string} uri
   * @param resource
   * @param options
   * @returns {Observable<any>}
   */
  public put<T>(uri: string, resource: any, options?: {}): Observable<T> {
    return Observable.create(observer => {
      let url = `${uri}`;
      winston.debug(`PUT ${url}`);

      const jsonStream = new JSONStream();
      let mergedOptions = { ...this.requestOptions, body: resource };
      request.put(url, mergedOptions)
        .on("response", response => {
          if (response.statusCode >= 400) {
            observer.error("Kubernetes responded with status " + response.statusCode + " " + response.statusMessage);
          }
        }).on("end", () => {
        winston.debug(`Done PUT ${url}`);
        observer.complete();
      })
        .on("error", error => {
          winston.error(`Error PUT ${url}`, error);
          observer.error(error);
        })
        .pipe(jsonStream);

      jsonStream.on("data", object => {
        observer.next(object);
      }).on("error", (error) => {
        winston.error(`Error PUT ${url}`, error);
        observer.error(error);
      });
    });
  }

  /**
   * Get nodes
   * @returns {Observable<Node[]>}
   */
  public getNodes(): Observable<Node[]> {
    return this.get<any>("/api/v1/nodes")
      .map(nodeList => nodeList.items as Node[]);
  }

  /**
   * Watch nodes
   * @returns {Observable<Node>}
   */
  public watchNodes(): Observable<Node> {
    return this.get<any>("/api/v1/nodes", { watch: true })
      .map(nodeList => nodeList.object as Node);
  }

  /**
   * Get all pods
   * @returns {Observable<Pod[]>}
   */
  public getPods(): Observable<Pod[]> {
    return this.get<any>("/api/v1/pods")
      .map(nodeList => nodeList.items as Pod[]);
  }

  /**
   * Get a pod
   * @returns {Observable<Pod>}
   */
  public getPod(namespace: string, name: string): Observable<Pod> {
    return this.get<any>(`/api/v1/namespaces/${namespace}/pods/${name}`)
      .map(nodeList => nodeList as Pod);
  }

  /**
   * Delete a pod
   * @returns {Observable<Pod>}
   */
  public deletePod(namespace: string, name: string): Observable<Pod> {
    return this.delete<any>(`/api/v1/namespaces/${namespace}/pods/${name}`);
  }

  /**
   * Get all pods
   * @returns {Observable<Pod[]>}
   */
  public watchPod(namespace: string, name: string): Observable<Watch<Pod>> {
    return this.get<any>(`/api/v1/namespaces/${namespace}/pods/${name}`, { watch: true})
      .map(nodeList => nodeList as Watch<Pod>);
  }

  /**
   * Get a replica-controller
   * @returns {Observable<ReplicaController>}
   */
  public getReplicaController(namespace: string, name: string): Observable<ReplicaController> {
    return this.get<any>(`/api/v1/namespaces/${namespace}/replicationcontrollers/${name}`)
      .map(nodeList => nodeList as ReplicaController);
  }

  /**
   * Get all replica-controllers
   * @returns {Observable<ReplicaController[]>}
   */
  public getReplicaControllers(): Observable<ReplicaController[]> {
    return this.get<any>("/api/v1/replicationcontrollers")
      .map(nodeList => nodeList.items as ReplicaController[]);
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
   * Scale the replicas of a replica-controller
   * @param {string} namespace
   * @param {string} dcName
   * @param {number} replicas
   * @returns {Observable<ReplicaController>}
   */
  public scaleDeploymentConfig(namespace: string, dcName: string, replicas: number): Observable<ReplicaController> {
    return Observable.create(observer => {
      let url = `/oapi/v1/namespaces/${namespace}/deploymentconfigs/${dcName}/scale`;
      this.get<ReplicaController>(url)
        .subscribe(rc => {
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
