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


export const storeState = makeEndpoint.main(
  'storeState',
  <{ key: string, newState: Record<string, any> }>_,
  <{ success: true }>_,
);


export const loadState = makeEndpoint.main(
  'loadState',
  <{ key: string }>_,
  <{ state: Record<string, any> }>_,
);
