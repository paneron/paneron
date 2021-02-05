import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import { ClipboardSource } from './types';


export const getClipboardStatus = makeEndpoint.main(
  'clipboardStatus',
  <{ workDir: string, datasetDir: string }>_,
  <{
    contents: null | { source: ClipboardSource, objectCount: number }
    canPaste: boolean
  }>_,
);


export const copyObjects = makeEndpoint.main(
  'copyObjects',
  <{ workDir: string, datasetDir: string, objects: ObjectDataset }>_,
  <{ success: true }>_,
);


export const requestCopiedObjects = makeEndpoint.main(
  'requestCopiedObjects',
  <EmptyPayload>_,
  <ObjectDataset>_,
);
