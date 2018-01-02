import { ApiModel, SpecModel, StatusModel } from "./api.model";

export interface Node extends ApiModel<NodeSpec, NodeStatus> {

}

export interface NodeSpec extends SpecModel {

  podCIDR?: string;
  providerID?: string;
  externalID?: string;
  unschedulable: boolean;

}

export interface NodeStatus extends StatusModel {

  capacity: NodeResource;
  allocatable: NodeResource;
  conditions: NodeCondition[];
  images: NodeDockerImage[];

}

export interface NodeResource {

  cpu: string;
  memory: string;
  pods: string;

}

export interface NodeCondition {

  type: string;
  status: string;
  lastHeartbeatTime: string;
  lastTransitionTime: string;
  reason: string;
  message: string;

}

export interface NodeDockerImage {

  names: string[];
  sizeBytes: number;

}
