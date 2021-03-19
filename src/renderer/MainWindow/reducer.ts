import log from 'electron-log';
import { RepositoryListQuery } from 'repositories/types';
import { Action } from './actions';


interface BaseState {
  view: string
  repoQuery: RepositoryListQuery
  selectedRepoWorkDir: unknown
  selectedDatasetID: unknown
}
interface RepoListState extends BaseState {
  view: 'repo-list'
  selectedRepoWorkDir: null | string
  selectedDatasetID: null 
}
interface OpenRepoState extends BaseState {
  view: 'repo-settings'
  selectedRepoWorkDir: string
  selectedDatasetID: null | string
}
interface OpenDatasetState extends BaseState {
  view: 'dataset'
  selectedRepoWorkDir: string
  selectedDatasetID: string
}
export type State =
  | RepoListState
  | OpenRepoState
  | OpenDatasetState


export const initialState: State = {
  view: 'repo-list',
  repoQuery: {},
  selectedRepoWorkDir: null,
  selectedDatasetID: null,
};


export default function reducer(prevState: State, action: Action): State {
  switch (action.type) {
    case 'open-repo-settings':
      return {
        ...prevState,
        view: 'repo-settings',
        selectedRepoWorkDir: action.workDir,
      };

    case 'select-dataset':
      if (prevState.selectedRepoWorkDir) {
        return {
          ...prevState,
          view: 'repo-settings',
          selectedDatasetID: action.datasetID,
          selectedRepoWorkDir: prevState.selectedRepoWorkDir,
        };
      }
      return prevState;

    case 'open-dataset':
      if (prevState.selectedRepoWorkDir) {
        return {
          ...prevState,
          view: 'dataset',
          selectedDatasetID: action.datasetID,
          selectedRepoWorkDir: prevState.selectedRepoWorkDir,
        };
      }
      return prevState;

    case 'close-dataset':
      if (prevState.selectedRepoWorkDir) {
        return {
          ...prevState,
          view: 'repo-settings',
          selectedRepoWorkDir: prevState.selectedRepoWorkDir,
          selectedDatasetID: null,
        };
      } else {
        log.warn("Trying to close dataset, but repo is not open");
        // Unexpected state, closing repo as well
        return {
          ...prevState,
          view: 'repo-list',
          selectedRepoWorkDir: null,
          selectedDatasetID: null,
        };
      }

    case 'close-repo':
      return {
        ...prevState,
        view: 'repo-list',
        selectedRepoWorkDir: null,
        selectedDatasetID: null,
      };

    default:
      throw new Error("Invalid action");
  }
}
