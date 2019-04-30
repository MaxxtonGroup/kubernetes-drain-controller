
export interface ApiResource {
  name: string;
  singularName: string;
  namspaced: boolean;
  kind: string;
  verbs: string[];
}
