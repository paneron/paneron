import { Action } from './actions';


interface BaseState {
  view: string
  selectedRepoWorkDir: unknown
  selectedDatasetID: unknown
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
}
export type State =
  | WelcomeScreenState
  | OpenDatasetState


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
    default:
      throw new Error("Invalid action");
  }
}
