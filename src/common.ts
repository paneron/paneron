import type { OpenDialogProps } from '@riboseinc/paneron-extension-kit/types';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { EmptyPayload, makeEndpoint, _ } from './ipc';


export const chooseFileFromFilesystem = makeEndpoint.main(
  'chooseFileFromFilesystem',
  <OpenDialogProps>_,
  <BufferDataset>_,
);


export const makeRandomID = makeEndpoint.main(
  'makeRandomID',
  <EmptyPayload>_,
  <{ id: string }>_,
);
