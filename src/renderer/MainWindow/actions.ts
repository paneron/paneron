import { BaseAction } from "renderer/usePersistentStateReducer";
import { RepositoryListQuery } from "repositories/types";


interface UpdateRepoQueryAction extends BaseAction {
  type: 'update-query'
  payload: RepositoryListQuery
}
interface AddRepoAction extends BaseAction {
  type: 'add-repo'
}
interface SelectRepoAction extends BaseAction {
  type: 'select-repo'
  workDir: string
}
interface OpenRepoAction extends BaseAction {
  type: 'open-repo-settings'
  workDir: string
}
interface SelectDatasetAction extends BaseAction {
  type: 'select-dataset'
  datasetID: string
}
interface OpenDatasetAction extends BaseAction {
  type: 'open-dataset'
  datasetID: string
}
interface CloseAction extends BaseAction {
  type: 'close-dataset' | 'close-repo'
}
export type Action =
  | UpdateRepoQueryAction
  | AddRepoAction
  | SelectRepoAction
  | OpenRepoAction
  | SelectDatasetAction
  | OpenDatasetAction
  | CloseAction
