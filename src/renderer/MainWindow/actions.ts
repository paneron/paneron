import { BaseAction } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';
import { RepositoryListQuery } from 'repositories/types';


interface UpdateRepoQueryAction extends BaseAction {
  type: 'update-query'
  payload: RepositoryListQuery
}
interface SelectRepoAction extends BaseAction {
  type: 'select-repo'
  workDir: string | null
}
interface OpenRepoAction extends BaseAction {
  type: 'open-repo-settings'
  workDir: string
}
interface SelectDatasetAction extends BaseAction {
  type: 'select-dataset'
  datasetID: string | null
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
  | SelectRepoAction
  | OpenRepoAction
  | SelectDatasetAction
  | OpenDatasetAction
  | CloseAction
