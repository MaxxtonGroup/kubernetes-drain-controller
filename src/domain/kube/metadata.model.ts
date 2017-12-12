
export interface Metadata {

  name: string;
  namespace: string;
  resourceVersion: string;
  labels: {[key: string]: string};
  annotations: {[key: string]: string};

}
