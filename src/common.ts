import type { OpenDialogProps } from '@riboseinc/paneron-extension-kit/types';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types';
import { EmptyPayload, makeEndpoint, _ } from './ipc';


export const chooseFileFromFilesystem = makeEndpoint.main(
  'chooseFileFromFilesystem',
  <OpenDialogProps>_,
  <ObjectDataset>_,
);


export const makeRandomID = makeEndpoint.main(
  'makeRandomID',
  <EmptyPayload>_,
  <{ id: string }>_,
);
