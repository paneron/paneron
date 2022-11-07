import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { DatasetInfo } from 'datasets/types';


export interface ClipboardSource {
  repository: {
    workDir: string;
    title: string;
  };
  dataset: {
    dir: string;
    meta: DatasetInfo;
  };
}


export interface RuntimeClipboard {
  contents: null | {
    source: ClipboardSource;
    objects: ObjectDataset;
  };
}
