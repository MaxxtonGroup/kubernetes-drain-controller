
import { ApiModel, SpecModel, StatusModel } from "./api.model";

export interface Pod extends ApiModel<PodSpec, PodStatus> {

}

export interface PodSpec extends SpecModel {

  restartPolicy: string;
  terminationGracePeriodSeconds: number;
  dnsPolicy: string;
  nodeSelector: {[key: string]: string};
  serviceAccountName: string;
  serviceAccount: string;
  nodeName: string;
  schedulerName: string;

}

export interface PodStatus extends StatusModel {

  phase: string;
  conditions: PodCondition[];
  hostIP: string;
  podIP: string;
  startTime: string;
  qosClass: string;

}

export interface PodCondition {

  type: string;
  status: string;
  lastProbeTime: string;
  lastTransitionTime: string;

}
