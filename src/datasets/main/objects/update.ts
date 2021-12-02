import path from 'path';
import { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import { ObjectChangeset, ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { getDatasetRoot } from 'repositories/main/meta';
import { updateDatasetIndexesIfNeeded } from '../loadedDatasets';
import { toBufferChangeset } from '../buffer-dataset-conversion';
import { API as Datasets } from '../../types';
import { diffObjectDatasets } from './equality';
import { readObjectCold } from './read';


export const updateObjects: Datasets.Data.UpdateObjects =
async function ({
  workDir,
  datasetID,
  objectChangeset,
  author,
  commitMessage,
  _dangerouslySkipValidation,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);

  const datasetRoot = getDatasetRoot('', datasetID);

  if (_dangerouslySkipValidation !== true) {
    const conflict = await findFirstConflictingObjectPath(
      workDir,
      datasetID,
      objectChangeset);

    if (conflict) {
      const [objectPath, changeStatus] = conflict;
      return { conflicts: { [objectPath]: changeStatus }};
    }
  }

  const bufferChangeset = toBufferChangeset(objectChangeset, datasetRoot);

  //console.debug("updateObjects: got changeset", JSON.stringify(objectChangeset), bufferChangeset);

  const result = await sync.repo_updateBuffers({
    workDir,
    author,
    commitMessage,
    bufferChangeset,
  });

  updateDatasetIndexesIfNeeded(workDir, datasetID);

  //const idx = getLoadedDataset(workDir, datasetID).indexes.default as Datasets.Util.DefaultIndex;
  //await getDefaultIndex(workDir, datasetID);
  //await fillInDefaultIndex(workDir, datasetID, idx, true);

  return result;
}


export const updateTree: Datasets.Data.UpdateTree =
async function ({
  workDir,
  datasetID,
  author,
  commitMessage,
  oldSubtreePath,
  newSubtreePath,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);

  const datasetRoot = getDatasetRoot('', datasetID);

  let result: CommitOutcome;

  if (newSubtreePath) {
    result = await sync.repo_moveTree({
      workDir,
      author,
      commitMessage,
      oldTreeRoot: path.posix.join(datasetRoot, oldSubtreePath),
      newTreeRoot: path.posix.join(datasetRoot, newSubtreePath),
    });
  } else {
    result = await sync.repo_deleteTree({
      workDir,
      author,
      commitMessage,
      treeRoot: path.posix.join(datasetRoot, oldSubtreePath),
    });
  }

  updateDatasetIndexesIfNeeded(workDir, datasetID);

  return result;
}


async function findFirstConflictingObjectPath(
  workDir: string,
  datasetID: string,
  objectChangeset: ObjectChangeset,
): Promise<[ objectPath: string, changeStatus: ChangeStatus ] | null> {

  if (Object.values(objectChangeset).find(change => change.oldValue === undefined)) {
    throw new Error("Undefined oldValue encountered when checking for conflicts");
  }

  const referenceObjectDataset: ObjectDataset = Object.fromEntries(
    Object.
      entries(objectChangeset).
      map(([path, change]) => [path, change.oldValue as Record<string, any> | null])
  );

  const paths = Object.keys(referenceObjectDataset);

  const datasetRoot = getDatasetRoot('', datasetID);

  async function readObjects(p: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    return [
      referenceObjectDataset[p],
      await readObjectCold(workDir, path.join(datasetRoot, p)),
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
