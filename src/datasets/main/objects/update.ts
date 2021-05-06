import * as R from 'ramda';
import { ChangeStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { ObjectChangeset, ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { normalizeDatasetDir } from '../loadedDatasets';
import { toBufferChangeset } from '../buffer-dataset-conversion';
import { API as Datasets } from '../../types';
import { diffObjectDatasets } from './equality';
import { readObject } from './read';


export const updateObjects: Datasets.Data.UpdateObjects =
async function ({
  workDir,
  datasetDir,
  objectChangeset,
  author,
  commitMessage,
  _dangerouslySkipValidation,
}) {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);
  const { workers: { sync } } = getLoadedRepository(workDir);

  if (_dangerouslySkipValidation !== true) {
    const conflict = await findFirstConflictingObjectPath(
      workDir,
      datasetDirNormalized,
      objectChangeset);

    if (conflict) {
      const [objectPath, changeStatus] = conflict;
      return { conflicts: { [objectPath]: changeStatus }};
    }
  }

  const bufferChangeset = toBufferChangeset(objectChangeset, datasetDir);

  return await sync.repo_updateBuffers({
    workDir,
    author,
    commitMessage,
    bufferChangeset,
  });
}


async function findFirstConflictingObjectPath(
  workDir: string,
  datasetDir: string,
  objectChangeset: ObjectChangeset,
): Promise<[ bufferPath: string, changeStatus: ChangeStatus ] | null> {

  const referenceObjectDataset = R.map<ObjectChangeset, ObjectDataset>(
    change => change.oldValue,
    objectChangeset);

  const paths = Object.keys(referenceObjectDataset);

  async function readObjects(p: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    return [
      referenceObjectDataset[p],
      await readObject(p, workDir, datasetDir),
    ];
  }

  async function* generatePaths() {
    for (const p of paths) {
      yield p;
    }
  }

  for await (const [objPath, diffStatus] of diffObjectDatasets(generatePaths(), readObjects)) {
    if (diffStatus !== 'unchanged') {
      return [objPath, diffStatus];
    }
  }

  return null;
}
