import { ApiModel, SpecModel, StatusModel } from "./api.model";

export interface ReplicaController extends ApiModel<ReplicaControllerSpec, ReplicaControllerStatus> {

}

export interface ReplicaControllerSpec extends SpecModel {

  replicas?: number;
  selector?: { [key: string]: string };

}

export interface ReplicaControllerStatus extends StatusModel {

  replicas: number;
  fullyLabeledReplicas: number;
  readyReplicas: number;
  availableReplicas: number;
  observedGeneration: number;

}
