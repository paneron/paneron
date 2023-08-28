import type { Action } from './actions';


interface BaseState {
  view: string
  selectedRepoWorkDir: null | string
  selectedDatasetID: null | string
}
interface SettingsState extends BaseState {
  view: 'settings'
  selectedRepoWorkDir: null | string
  selectedDatasetID: null | string

  // NOTE: Cannot guarantee prevState for backwards compatibility.
  prevState?: WelcomeScreenState | OpenDatasetState
}
interface WelcomeScreenState extends BaseState {
  view: 'welcome-screen'
  selectedRepoWorkDir: null
  selectedDatasetID: null
}
interface OpenDatasetState extends BaseState {
  view: 'dataset'
  selectedRepoWorkDir: string
  selectedDatasetID: string
  export?: boolean
}
export type State =
  | WelcomeScreenState
  | OpenDatasetState
  | SettingsState


export const initialState: State = {
  view: 'welcome-screen',
  selectedRepoWorkDir: null,
  selectedDatasetID: null,
};


export default function reducer(prevState: State, action: Action): State {
  switch (action.type) {
    case 'open-dataset':
      return {
        ...prevState,
        view: 'dataset',
        export: false,
        selectedDatasetID: action.datasetID,
        selectedRepoWorkDir: action.workDir,
      };
    case 'close-dataset':
      return {
        ...prevState,
        view: 'welcome-screen',
        selectedRepoWorkDir: null,
        selectedDatasetID: null,
      };
    case 'export-dataset':
      return {
        ...prevState,
        view: 'dataset',
        export: true,
        selectedDatasetID: action.datasetID,
        selectedRepoWorkDir: action.workDir,
      };
    case 'open-settings':
      if (prevState.view === 'dataset' || prevState.view === 'welcome-screen') {
        return {
          ...prevState,
          prevState,
          view: 'settings',
        };
      } else {
        return prevState;
      }
    case 'close-settings':
      if (prevState.view === 'settings' && prevState.prevState) {
        return prevState.prevState;
      } else {
        return initialState;
      }
    default:
      throw new Error("Invalid action");
  }
}
