import { Metadata } from "./metadata.model";

export interface ApiModel<SPEC extends SpecModel, STATUS extends StatusModel> {

  kind: string;
  apiVersion: string;
  metadata: Metadata;
  spec: SPEC;
  status?: STATUS;

}

export interface SpecModel {

}

export interface StatusModel {

}

export interface Watch<T extends ApiModel<any, any>> {

  type: string;
  object: T;

}
