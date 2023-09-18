import nodePath from 'path';

import type { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import type { ObjectChangeset, ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { resolveDatasetAlias } from 'repositories/main/meta';
import { readLFSParams } from 'repositories/main/readRepoConfig';
import type { LFSParams } from 'repositories/types';
import { joinPaths } from 'utils';
import { updateDatasetIndexesIfNeeded } from '../loadedDatasets';
import { toBufferChangeset } from '../buffer-dataset-conversion';
import { API as Datasets } from '../../types';
import { diffObjectDatasets } from '../../util';
import { readObjectCold } from './read';


export const updateObjects: Datasets.Data.UpdateObjects =
async function updateObjects ({
  workDir,
  datasetID,
  objectChangeset,
  author,
  commitMessage,
  _dangerouslySkipValidation,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);

  const datasetRoot = resolveDatasetAlias(datasetID);

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
async function updateTree ({
  workDir,
  datasetID,
  author,
  commitMessage,
  oldSubtreePath,
  newSubtreePath,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);

  const datasetRoot = resolveDatasetAlias(datasetID);

  let result: CommitOutcome;

  if (newSubtreePath) {
    result = await sync.repo_moveTree({
      author,
      commitMessage,
      oldTreeRoot: joinPaths(datasetRoot, oldSubtreePath),
      newTreeRoot: joinPaths(datasetRoot, newSubtreePath),
    });
  } else {
    result = await sync.repo_deleteTree({
      author,
      commitMessage,
      treeRoot: joinPaths(datasetRoot, oldSubtreePath),
    });
  }

  updateDatasetIndexesIfNeeded(workDir, datasetID);

  return result;
}


export const addExternal: Datasets.Data.UpdateObjectsExternal =
async function addExternal ({
  workDir,
  datasetID,
  commitMessage,
  author,
  absoluteFilepaths,
  targetPath,
  replaceTarget,
  offloadToLFS,
}) {
  const datasetRoot = resolveDatasetAlias(datasetID);
  const pathMap: Record<string, string> = {};

  if (absoluteFilepaths.length > 0) {
    if (replaceTarget) {
      const bufferPath = joinPaths(datasetRoot, targetPath);
      pathMap[absoluteFilepaths[0]] = bufferPath;
    } else {
      for (const fp of absoluteFilepaths) {
        const fn = nodePath.basename(fp);
        const bufferPath = joinPaths(datasetRoot, targetPath, fn);
        pathMap[fp] = bufferPath;
      }
    }
  } else {
    throw new Error("No absolute paths were given");
  }

  const { workers: { sync } } = getLoadedRepository(workDir);

  let lfsParams: LFSParams | undefined = undefined;
  if (offloadToLFS) {
    lfsParams = await readLFSParams(workDir);
  }

  const result = await sync.repo_addExternalBuffers({
    commitMessage,
    author,
    paths: pathMap,
    offloadToLFS: lfsParams,
  });

  updateDatasetIndexesIfNeeded(workDir, datasetID);

  return result;
}


/**
 * Does consistency check against `oldValue`s in object changeset.
 *
 * Returns a 2-tuple describing the first encountered object for which
 * deserialized fresh contents in cold storage differ from the old value,
 * or null.
 */
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

  const datasetRoot = resolveDatasetAlias(datasetID);

  async function readObjects(p: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    return [
      referenceObjectDataset[p],
      await readObjectCold(workDir, joinPaths(datasetRoot, p)),
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
