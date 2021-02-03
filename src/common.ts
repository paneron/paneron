import type { OpenDialogProps } from '@riboseinc/paneron-extension-kit/types';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { EmptyPayload, makeEndpoint, _ } from './ipc';


export const copyObjects = makeEndpoint.main(
  'requestCopiedObjects',
  <ObjectDataset>_,
  <{ success: true }>_,
);


export const requestCopiedObjects = makeEndpoint.main(
  'requestCopiedObjects',
  <EmptyPayload>_,
  <ObjectDataset>_,
);


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
