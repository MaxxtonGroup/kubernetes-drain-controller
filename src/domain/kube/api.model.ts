import { Metadata } from "./metadata.model";

export interface ApiModel<SPEC extends SpecModel, STATUS extends StatusModel> {

  metadata: Metadata;
  spec: SPEC;
  status: STATUS;

}

export interface SpecModel {

  replicas: number;
  selector: { [key: string]: string };

}

export interface StatusModel {

  replicas: number;
  fullyLabeledReplicas: number;
  readyReplicas: number;
  availableReplicas: number;

}

export interface Watch<T extends ApiModel<any, any>> {

  type: string;
  object: T;

}
