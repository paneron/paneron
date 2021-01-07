import path from 'path';
import yaml from 'js-yaml';
import { DatasetInfo } from '../types';
import repoWorker from 'main/repositories/workerInterface';


export const DATASET_FILENAME = 'panerondataset.yaml';


export async function readDatasetMeta
(workingCopyPath: string, datasetPath?: string):
Promise<DatasetInfo> {
  const meta = (await (await repoWorker).getObjectContents({
    workDir: path.join(workingCopyPath, datasetPath || ''),
    readObjectContents: { [DATASET_FILENAME]: 'utf-8' },
  }))[DATASET_FILENAME];

  if (meta === null) {
    throw new Error("Missing dataset metadata file");
  } else if (meta?.encoding !== 'utf-8') {
    throw new Error("Invalid dataset metadata file format");
  } else {
    return yaml.load(meta.value);
  }
}
