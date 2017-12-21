import { ApiModel, SpecModel, StatusModel } from "./api.model";

export interface DeploymentConfig extends ApiModel<DeploymentConfigSpec, DeploymentConfigStatus> {

}

export interface DeploymentConfigSpec extends SpecModel {

  replicas: number;

}

export interface DeploymentConfigStatus extends StatusModel {

  selector: { [key: string]: string };
  targetSelector: string;
  replicas: number;
  fullyLabeledReplicas: number;
  readyReplicas: number;
  availableReplicas: number;
  observedGeneration: number;

}
