import type { OpenFileDialogProps, SelectDirectoryProps, SaveFileDialogProps } from '@riboseinc/paneron-extension-kit/types/dialogs';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { makeWindowForComponent } from './window';
import { EmptyPayload, makeEndpoint, _ } from './ipc';


export const CLEAR_OPTIONS = [
  'ui-state',
  'db-indexes',
  'plugins',
  //'settings',
  'repositories',
] as const;

export type ClearOption = typeof CLEAR_OPTIONS[number];


export const clearDataAndRestart = makeEndpoint.main(
  'clearDataAndRestart',
  <{ options: Record<ClearOption, boolean> }>_,
  <{ success: true }>_,
);


export const chooseFileFromFilesystem = makeEndpoint.main(
  'chooseFileFromFilesystem',
  <OpenFileDialogProps>_,
  <BufferDataset>_,
);


export const selectDirectoryPath = makeEndpoint.main(
  'selectDirectoryPath',
  <SelectDirectoryProps>_,
  <{ directoryPath?: string }>_,
);


export const openExternalURL = makeEndpoint.main(
  'openExternalURL',
  <{ url: string }>_,
  <EmptyPayload>_,
);


export const saveFileToFilesystem = makeEndpoint.main(
  'saveFileToFilesystem',
  <{ dialogOpts: SaveFileDialogProps, bufferData: Uint8Array }>_,
  <{ success: true, savedToFileAtPath: string }>_,
);


export const makeRandomID = makeEndpoint.main(
  'makeRandomID',
  <EmptyPayload>_,
  <{ id: string }>_,
);


export const mainWindow = makeWindowForComponent(
  'mainWindow',
  () => import('./renderer/MainWindow/index'),
  'MainWindow',
  {
    dimensions: {
      minWidth: 800,
      minHeight: 600,
      width: 800,
      height: 600,
    },
  },
);
