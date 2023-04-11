import { BaseAction } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';


interface OpenDatasetAction extends BaseAction {
  type: 'open-dataset'
  workDir: string
  datasetID: string
}
interface ExportDatasetAction extends Omit<OpenDatasetAction, 'type'> {
  type: 'export-dataset'
}
interface CloseAction extends BaseAction {
  type: 'close-dataset'
}
export type Action =
  | OpenDatasetAction
  | ExportDatasetAction
  | CloseAction
