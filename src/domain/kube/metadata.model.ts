
export interface Metadata {

  name: string;
  namespace?: string;
  resourceVersion?: string;
  labels?: {[key: string]: string};
  annotations?: {[key: string]: string};
  ownerReferences?: OwnerReference[];

}

export interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  controller?: boolean;
  uid?: string;
  blockOwnerDeletion?: boolean;
}
