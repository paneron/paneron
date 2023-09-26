import type { BaseAction } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';


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
interface OpenSettingsAction extends BaseAction {
  type: 'open-settings'
}
interface CloseSettingsAction extends BaseAction {
  type: 'close-settings'
}
export type Action =
  | OpenDatasetAction
  | ExportDatasetAction
  | CloseAction
  | OpenSettingsAction
  | CloseSettingsAction
