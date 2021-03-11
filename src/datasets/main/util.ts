import path from 'path';
import { getLoadedRepository } from 'main/repositories/loadedRepositories';
import { normalizeDatasetDir } from 'main/repositories/worker/datasets';
import { deserializeMeta } from 'main/meta-serdes';
import { DatasetInfo } from '../types';


export const DATASET_FILENAME = 'panerondataset.yaml';


export async function readDatasetMeta
(workDir: string, datasetDir: string):
Promise<DatasetInfo> {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);
  const datasetMetaPath = `/${path.join(datasetDirNormalized, DATASET_FILENAME)}`;
  const repoWorker = getLoadedRepository(workDir).workers.reader;
  const meta = (await repoWorker.repo_getBufferDataset({
    workDir,
    paths: [datasetMetaPath],
  }))[datasetMetaPath];

  if (meta === null) {
    throw new Error("Missing dataset metadata file");
  } else {
    return deserializeMeta(meta);
  }
}
