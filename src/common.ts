import type { OpenDialogProps, SaveDialogProps } from '@riboseinc/paneron-extension-kit/types';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { makeWindowForComponent } from './window';
import { EmptyPayload, makeEndpoint, _ } from './ipc';


export const chooseFileFromFilesystem = makeEndpoint.main(
  'chooseFileFromFilesystem',
  <OpenDialogProps>_,
  <BufferDataset>_,
);


export const saveFileToFilesystem = makeEndpoint.main(
  'saveFileToFilesystem',
  <{ dialogOpts: SaveDialogProps, bufferData: Uint8Array }>_,
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
