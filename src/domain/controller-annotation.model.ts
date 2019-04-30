
export interface  ControllerAnnotation {

  name: string;
  kind: string;
  resourceName: string;
  apiVersion: string;
  namespace: string;
  original: number;
  current: number;
  desired: number;
  readyTime?: number;
  pods: string[];

}
