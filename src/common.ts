import type { OpenDialogProps } from '@riboseinc/paneron-extension-kit/types';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types';
import { makeEndpoint, _ } from './ipc';


export const chooseFileFromFilesystem = makeEndpoint.main(
  'chooseFileFromFilesystem',
  <OpenDialogProps>_,
  <ObjectDataset>_,
);
