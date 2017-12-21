import * as JSONStream from "json-stream";
import * as request from "request";
import { Observable } from "rxjs";
import { Service } from "typedi";
import * as winston from "winston";
import { KubeConfig } from "../../config/kube.config";
import { KubeClient } from "../kube.client";

/**
 * Kubernetes API client
 */
@Service("kube-client")
export class HttpKubeClient extends KubeClient {

  private requestOptions: request.CoreOptions;

  constructor(kubeConfig: KubeConfig) {
    super();
    this.requestOptions = kubeConfig.getRequestOptions();
  }

  /**
   * Get or watch resource
   * @param method
   * @param {string} uri
   * @param options
   * @returns {Observable<any>}
   */
  public request<T>(method: string, uri: string, options?: request.CoreOptions): Observable<T> {
    return Observable.create(observer => {
      winston.debug(`${method} ${uri}`);

      let jsonStream: any = JSONStream();
      let mergedOptions: any = { ...this.requestOptions, ...options };
      if (mergedOptions.body) {
        winston.silly("Request: ", JSON.stringify(mergedOptions.body));
      }
      mergedOptions.url = uri;
      mergedOptions.method = method;
      mergedOptions.headers.Authorization = this.requestOptions.headers.Authorization;
      request(mergedOptions, (e, response, body) => {
        if (e) {
          let error = new Error(e);
          winston.error(`Error ${method} ${uri}`, error);
          observer.error(error);
        } else if (response.statusCode >= 400) {
          let error = new Error(
            `${method} ${uri} responded with status ${response.statusCode} ${response.statusMessage}`);
          winston.warn(error.message);
          observer.error(error);
        }
      }).on("end", () => {
        winston.debug(`Done ${method} ${uri}`);
        observer.complete();
      }).pipe(jsonStream);

      jsonStream.on("data", object => {
        winston.silly("Response: ", object);
        observer.next(object);
      }).on("error", (error) => {
        winston.error(`Error ${method} ${uri}`, error);
        observer.error(error);
      });
    });
  }

}
