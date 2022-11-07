import { BaseAction } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';


interface OpenDatasetAction extends BaseAction {
  type: 'open-dataset'
  workDir: string
  datasetID: string
}
interface CloseAction extends BaseAction {
  type: 'close-dataset'
}
export type Action =
  | OpenDatasetAction
  | CloseAction
