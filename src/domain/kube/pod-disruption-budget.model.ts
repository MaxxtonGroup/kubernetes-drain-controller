import { ApiModel, SpecModel, StatusModel } from "./api.model";

export interface PodDisruptionBudgetModel extends ApiModel<PodDisruptionBudgetSpecModel, PodDisruptionBudgetStatus> {

}

export interface PodDisruptionBudgetSpecModel extends SpecModel {
  minAvailable: number;
  selector: {
    matchLabels: {[key: string]: string}
  };
}

export interface PodDisruptionBudgetStatus extends StatusModel {
  currentHealthy: number;
  desiredHealthy: number;
  disruptedPods: number;
  disruptionsAllowed: number;
  expectedPods: number;
  observedGeneration: number;

}
