import path from 'path';
import yaml from 'js-yaml';
import repoWorker from 'main/repositories/workerInterface';
import { normalizeDatasetDir } from 'main/repositories/worker/datasets';
import { DatasetInfo } from '../types';


export const DATASET_FILENAME = 'panerondataset.yaml';


const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');


export function deserializeMeta<T = Record<string, any>>(data: Uint8Array): T {
  return yaml.load(decoder.decode(data));
}


export function serializeMeta(data: Record<string, any>) {
  return encoder.encode(yaml.dump(data, { noRefs: true }));
}


export async function readDatasetMeta
(workDir: string, datasetDir: string):
Promise<DatasetInfo> {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);
  const datasetMetaPath = `/${path.join(datasetDirNormalized, DATASET_FILENAME)}`;
  const meta = (await (await repoWorker).repo_getBufferDataset({
    workDir,
    paths: [datasetMetaPath],
  }))[datasetMetaPath];

  if (meta === null) {
    throw new Error("Missing dataset metadata file");
  } else {
    return deserializeMeta(meta);
  }
}
