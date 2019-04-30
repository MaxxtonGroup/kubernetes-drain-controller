import * as atob from "atob";
import * as fs from "fs";
import * as jsyaml from "js-yaml";
import * as os from "os";
import * as path from "path";
import * as request from "request";
import * as winston from "winston";

export class KubeConfig {

  /**
   * Get Request options based on the kubeconfig or from within a cluster
   * @returns {requestPromise.RequestPromiseOptions}
   */
  public getRequestOptions(): request.CoreOptions | null {
    const kubeConfig = this.loadKubeConfig();
    if (kubeConfig) {
      winston.info("Use kubeconfig");
      return this.getKubeConfigRequestOptions(kubeConfig);
    } else {
      return this.loadClusterKubeConfig();
    }
  }

  /**
   * Load kube config from within the cluster
   * @returns {any}
   */
  private loadClusterKubeConfig(): any | null {
    const kubeConfigClusterPath = "/var/run/secrets/kubernetes.io/serviceaccount";
    if (fs.existsSync(kubeConfigClusterPath)) {
      let tokenFile = path.join(kubeConfigClusterPath, "token");
      let caFile = path.join(kubeConfigClusterPath, "ca.crt");
      if (fs.existsSync(tokenFile) && fs.existsSync(caFile)) {
        let token = fs.readFileSync(tokenFile).toString();
        let ca = fs.readFileSync(caFile);

        if (process.env["KUBERNETES_SERVICE_HOST"] && process.env["KUBERNETES_SERVICE_PORT"]) {
          // Create request options
          const options: request.CoreOptions = { json: true };
          options.headers = {
            "Content-Type": "application/json"
          };
          options.strictSSL = true;
          options.baseUrl = "";
          options.ca = ca;
          options.baseUrl =
            `https://${process.env["KUBERNETES_SERVICE_HOST"]}:${process.env["KUBERNETES_SERVICE_PORT"]}`;

          options.headers.Authorization = "Bearer " + token;
          return options;
        }
      }
    }
    return null;
  }

  /**
   * Load kube config from ~/.kube/config
   * @returns {any}
   */
  private loadKubeConfig(): any | null {
    const kubeConfigPath = path.join(os.homedir(), ".kube/config");
    if (fs.existsSync(kubeConfigPath)) {
      return jsyaml.safeLoad(fs.readFileSync(kubeConfigPath).toString());
    }
    return null;
  }

  /**
   * Get request config from kubeConfig
   * @param kubeConfig
   * @returns {requestPromise.RequestPromiseOptions}
   */
  private getKubeConfigRequestOptions(kubeConfig: any): request.CoreOptions {
    // Find current context
    const currentContext = kubeConfig["current-context"];
    if (!currentContext) {
      throw new Error("kubeconfig: missing current-context");
    }
    if (!kubeConfig.contexts) {
      throw new Error("kubeconfig: missing contexts");
    }
    const context = kubeConfig.contexts.filter((context) => context.name === currentContext)[0];
    if (!context) {
      throw new Error("kubeconfig: current-context not found");
    }

    // Find cluster
    if (!context.context || !context.context.cluster) {
      throw new Error("kubeconfig: missing cluster in context");
    }
    if (!kubeConfig.clusters) {
      throw new Error("kubeconfig: missing clusters");
    }
    const currentCluster = context.context.cluster;
    const cluster = kubeConfig.clusters.filter((cluster) => cluster.name === currentCluster)[0];
    if (!cluster) {
      throw new Error("kubeconfig: cluster '" + currentCluster + "' not found");
    }

    // Find user
    if (!context.context || !context.context.user) {
      throw new Error("kubeconfig: missing user in context");
    }
    if (!kubeConfig.users) {
      throw new Error("kubeconfig: missing users");
    }
    const currentUser = context.context.user;
    const user = kubeConfig.users.filter((user) => user.name === currentUser)[0];
    if (!user) {
      throw new Error("kubeconfig: user '" + user + "' not found");
    }

    // Create request options
    const options: request.CoreOptions = { json: true };
    options.headers = {
      "Content-Type": "application/json"
    };
    if (!cluster.cluster) {
      throw new Error("kubeconfig: cluster.cluster not found");
    }
    options.strictSSL = !cluster.cluster["insecure-skip-tls-verify"];
    options.baseUrl = cluster.cluster["server"];
    if (cluster.cluster["certificate-authority-data"]) {
      options.ca = atob(cluster.cluster["certificate-authority-data"]);
    }

    if (!user.user) {
      throw new Error("kubeconfig: user.user not found");
    }
    if (user.user["token"]) {
      options.headers.Authorization = "Bearer " + user.user["token"];
    } else if (user.user["client-certificate-data"] && user.user["client-key-data"]) {
      options.cert = new Buffer(atob(user.user["client-certificate-data"]));
      options.key = new Buffer(atob(user.user["client-key-data"]));
    }

    return options;
  }

}
