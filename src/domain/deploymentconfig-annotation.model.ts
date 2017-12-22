
export interface  DeploymentConfigAnnotation {

  name: string;
  namespace: string;
  original: number;
  current: number;
  desired: number;
  readyTime?: number;
  pods: string[];

}
