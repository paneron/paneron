import log from 'electron-log';
import path from 'path';
//import * as R from 'ramda';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import lexint from 'lexicographic-integer';
import { CodecOptions } from 'level-codec';
import { throttle } from 'throttle-debounce';

import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { Changeset, ChangeStatus, PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';
import { findSerDesRuleForPath } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';

import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import { listDescendantPaths } from 'repositories/worker/buffers/list';
import { hash, stripLeadingSlash, stripTrailingSlash } from 'utils';
import { API as Datasets, ReturnsPromise } from '../types';
import { indexStatusChanged, objectsChanged } from '../ipc';
import { listObjectPaths } from './objects/list';
import { readObjectCold } from './objects/read';


// We’ll just keep track of loaded datasets right here in memory.
// { datasetID: { objectPath: { field1: value1, ... }}}
const datasets: {
  [workDir: string]: {
    [datasetDir: string]: Datasets.Util.LoadedDataset
  }
} = {};


// Main API

const load: Datasets.Lifecycle.Load = async function ({
  workDir,
  datasetDir,
  cacheRoot,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  try {
    getLoadedDataset(workDir, normalizedDatasetDir);
    console.info("Datasets: Load: Already loaded!", workDir, normalizedDatasetDir);

  } catch (e) {
    console.info("Datasets: Load: Unloading first to clean up", workDir, normalizedDatasetDir);

    await unload({ workDir, datasetDir });

    datasets[workDir] ||= {};
    datasets[workDir][normalizedDatasetDir] = {
      indexDBRoot: cacheRoot,
      indexes: {},
    };

    const defaultIndex = await createDefaultIndex(
      workDir,
      normalizedDatasetDir,
    ) as Datasets.Util.DefaultIndex;

    datasets[workDir][normalizedDatasetDir].indexes.default = defaultIndex,

    console.info("Datasets: Load: Initialized dataset in-memory structure and default index", workDir, normalizedDatasetDir);

    fillInDefaultIndex(workDir, normalizedDatasetDir, defaultIndex);
  }
}


const unload: Datasets.Lifecycle.Unload = async function ({
  workDir,
  datasetDir,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  try {
    const ds = getLoadedDataset(workDir, normalizedDatasetDir);
    for (const { dbHandle /* statusSubject */ } of Object.values(ds.indexes)) {
      await dbHandle.close();
      //statusSubject.complete();
    }
  } catch (e) {
    // TODO: Implement logging in worker
  }
  delete datasets[workDir]?.[datasetDir];
  console.info("Datasets: Unloaded", workDir, datasetDir)
}


const unloadAll: Datasets.Lifecycle.UnloadAll = async function ({
  workDir,
}) {
  for (const datasetDir of Object.keys(datasets[workDir] ?? {})) {
    await unload({ workDir, datasetDir });
  }
}


const getOrCreateFilteredIndex: ReturnsPromise<Datasets.Indexes.GetOrCreateFiltered> = async function ({
  workDir,
  datasetDir,
  queryExpression,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  const defaultIndex: Datasets.Util.DefaultIndex =
    await getDefaultIndex(workDir, normalizedDatasetDir);

  const filteredIndexID = hash(queryExpression); // XXX

  console.debug(
    `Datasets: getOrCreateFilteredIndex: Creating ${datasetDir} index from ${defaultIndex.status.objectCount} items based on query`,
    queryExpression,
    filteredIndexID);

  let filteredIndex: Datasets.Util.FilteredIndex;
  try {

    filteredIndex = getFilteredIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
    ) as Datasets.Util.FilteredIndex;

    console.debug("Datasets: getOrCreateFilteredIndex: Already exists");

  } catch (e) {

    console.debug("Datasets: getOrCreateFilteredIndex: Creating");

    let predicate: Datasets.Util.FilteredIndexPredicate;
    try {
      predicate = new Function('objPath', 'obj', queryExpression) as Datasets.Util.FilteredIndexPredicate;
    } catch (e) {
      throw new Error("Unable to parse submitted predicate expression");
    }

    filteredIndex = createFilteredIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
      predicate,
    ) as Datasets.Util.FilteredIndex;

    const statusReporter = getFilteredIndexStatusReporter(workDir, normalizedDatasetDir, filteredIndexID);

    // This will proceed in background.
    fillInFilteredIndex(defaultIndex, filteredIndex, statusReporter);
  }

  return { indexID: filteredIndexID };
}


const describeIndex: ReturnsPromise<Datasets.Indexes.Describe> = async function ({
  workDir,
  datasetDir,
  indexID,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  let idx: Datasets.Util.ActiveDatasetIndex<any, any>;
  if (indexID) {
    idx = getFilteredIndex(workDir, normalizedDatasetDir, indexID);
  } else {
    idx = await getDefaultIndex(workDir, normalizedDatasetDir);
  }
  return {
    status: idx.status,
  };
}


//const streamIndexStatus: WorkerMethods["ds_index_streamStatus"] = function ({
//  workDir,
//  datasetDir,
//  indexID,
//}) {
//  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
//  const idx = getIndex(workDir, normalizedDatasetDir, indexID);
//  return Observable.from(idx.statusSubject);
//}


const getFilteredObject: Datasets.Indexes.GetFilteredObject = async function ({
  workDir,
  datasetDir,
  indexID,
  position,
}) {
  if (indexID === 'default') {
    throw new Error("Default index is not supported by getFilteredObject");
  }

  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  const idx = getFilteredIndex(
    workDir,
    normalizedDatasetDir,
    indexID) as Datasets.Util.FilteredIndex;
  const db = idx.dbHandle;
  const objectPath = await db.get(position);

  return { objectPath };
}


const locatePositionInFilteredIndex: Datasets.Indexes.LocatePositionInFilteredIndex = async function ({
  workDir,
  datasetDir,
  indexID,
  objectPath,
}) {
  if (indexID === 'default') {
    throw new Error("Default index is not supported by locatePositionInFilteredIndex");
  }

  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  const idx = getFilteredIndex(
    workDir,
    normalizedDatasetDir,
    indexID) as Datasets.Util.FilteredIndex;
  const db = idx.dbHandle;

  for await (const data of db.createReadStream()) {
    const { key, value } = data as unknown as { key: number, value: string };
    if (value === objectPath) {
      return { position: key };
    }
  }

  throw new Error("Index position not found (probably given path doesn’t exist in the index)");
}


const resolveDatasetChanges: (opts: {
  workDir: string
  datasetDir: string
  oidBefore: string
  oidAfter: string
}) => Promise<{
  changedObjectPaths: AsyncGenerator<string>,
}> = async function ({
  workDir,
  datasetDir,
  oidBefore,
  oidAfter,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);

  // Find which buffers were added/removed/modified
  const { changedBuffers } = await sync.repo_resolveChanges({
    rootPath: `/${datasetDir}`,
    workDir,
    oidBefore,
    oidAfter,
  });

  // Simply transforms the list of buffer paths to an async generator of strings.
  async function* getChangedPaths(changes: [ string, ChangeStatus ][]) {
    for (const [p, _] of changes) {
      yield p;
    }
  }

  const changedObjectPaths = listObjectPaths(getChangedPaths(changedBuffers));

  return { changedObjectPaths };
}


export default {
  load,
  unload,
  unloadAll,
  getOrCreateFilteredIndex,
  describeIndex,
  //streamIndexStatus,
  getFilteredObject,
  locatePositionInFilteredIndex,
  resolveDatasetChanges,
};


// Updates dataset indexes, sends relevant notifications.
async function updateIndexes(
  workDir: string,
  datasetDir: string, // Should be normalized.
  defaultIndex: Datasets.Util.DefaultIndex,
  changedObjectPaths: AsyncGenerator<string>,
  oid1: string, // commit hash “before”
  oid2: string, // commit hash “after”
) {
  const ds = getLoadedDataset(workDir, datasetDir);
  const affectedFilteredIndexes: [idx: Datasets.Util.FilteredIndex, idxID: string][] = [];

  const { workers: { sync } } = getLoadedRepository(workDir);

  const filteredIndexIDsToCheck: string[] =
    Object.keys(ds.indexes).filter(k => k !== 'default');

  const defaultIdxDB = defaultIndex.dbHandle;

  const defaultIndexStatusReporter = getDefaultIndexStatusReporter(workDir, datasetDir);

  async function readObjectVersions(objectPath: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    const rule = findSerDesRuleForPath(objectPath);

    const bufDs1 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oid1 });
    const bufDs2 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oid2 });

    const objDs1: Record<string, any> | null = Object.keys(bufDs1).length > 0 ? rule.deserialize(bufDs1, {}) : null;
    const objDs2: Record<string, any> | null = Object.keys(bufDs2).length > 0 ? rule.deserialize(bufDs2, {}) : null;

    if (objDs1 === null && objDs2 === null) {
      log.error("Datasets: updateIndexes: Unable to read either object version", path.join(datasetDir, objectPath), oid1, oid2);
      throw new Error("Unable to read either object version");
    }

    return [
      objDs1,
      objDs2,
    ];
  }

  const changes: Record<string, true | ChangeStatus> = {};
  let idx: number = 0;

  // Update default index and infer which filtered indexes are affected
  for await (const objectPath of changedObjectPaths) {
    idx += 1;

    // Read “before” and “after” object versions
    const [objv1, objv2] = await readObjectVersions(objectPath);

    // Update or delete structured object data in default index
    if (objv2 !== null) {
      // Object was changed or added
      defaultIdxDB.put(objectPath, objv2);
      if (objv1 === null) {
        changes[objectPath] = 'added';
        defaultIndexStatusReporter({
          objectCount: defaultIndex.status.objectCount + 1,
          progress: {
            phase: 'indexing',
            total: defaultIndex.status.objectCount,
            loaded: idx,
          },
        });
      } else {
        changes[objectPath] = 'modified';
        defaultIndexStatusReporter({
          objectCount: defaultIndex.status.objectCount,
          progress: {
            phase: 'indexing',
            total: defaultIndex.status.objectCount,
            loaded: idx,
          },
        });
      }
    } else {
      // Object was deleted
      try {
        defaultIdxDB.del(objectPath);
        changes[objectPath] = 'removed';
        defaultIndexStatusReporter({
          objectCount: defaultIndex.status.objectCount - 1,
          progress: {
            phase: 'indexing',
            total: defaultIndex.status.objectCount,
            loaded: idx,
          },
        });
      } catch (e) {
        if (e.type === 'NotFoundError') {
          // (or even never existed)
          changes[objectPath] = true;
        } else {
          throw e;
        }
      }
    }

    // XXX: Instead of updating indexes here, we could do this on subsequent requests?
    // (The problem is that here we specifically know which objects changed,
    // outside of this scope we would have to retrieve this information again.)

    // Check all filtered indexes that have not yet been marked as affected
    for (const idxID of filteredIndexIDsToCheck) {
      const idx = ds.indexes[idxID] as Datasets.Util.FilteredIndex;
      // If either object version matches given filtered index’s predicate,
      // mark that index as affected and exclude from further checks
      if ((objv1 && idx.predicate(objectPath, objv1)) || (objv2 && idx.predicate(objectPath, objv2))) {
        affectedFilteredIndexes.push([idx, idxID]);
        filteredIndexIDsToCheck.splice(filteredIndexIDsToCheck.indexOf(idxID, 1));
      }
    }
  }

  defaultIndexStatusReporter({
    objectCount: defaultIndex.status.objectCount,
  });

  await objectsChanged.main!.trigger({
    workingCopyPath: workDir,
    datasetPath: datasetDir,
    objects: changes,
  });

  // Rebuild affected filtered indexes
  for (const [filteredIndex, filteredIndexID] of affectedFilteredIndexes) {
    const statusReporter = getFilteredIndexStatusReporter(workDir, datasetDir, filteredIndexID);

    await filteredIndex.dbHandle.clear();
    await fillInFilteredIndex(defaultIndex, filteredIndex, statusReporter);
  }
}


async function updateDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
  changedObjectPathGenerator: AsyncGenerator<string>,
  statusReporter: (indexedItemCount: number) => void,
) {
  let loaded: number = 0;

  for await (const objectPath of changedObjectPathGenerator) {
    //console.debug("Datasets: updateDefaultIndex: Reading...", objectPath);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const obj = await readObjectCold(workDir, path.join(datasetDir, objectPath));

    if (obj !== null) {
      await index.dbHandle.put(objectPath, obj);
      //console.debug("Datasets: updateDefaultIndex: Indexed", objectPath, obj ? Object.keys(obj) : null);
    } else {
      try {
        await index.dbHandle.del(objectPath);
        //console.debug("Datasets: updateDefaultIndex: Deleted", objectPath);
      } catch (e) {
        if (e.type !== 'NotFoundError') {
          throw e;
        }
      }
    }

    loaded += 1;

    statusReporter(loaded);
  }
}


// Utility functions

// function changedPathsToPathChanges(
//   changedPaths: [path: string, change: ChangeStatus][]
// ): PathChanges {
//   const pathChanges: PathChanges = changedPaths.
//     map(([path, change]) => ({ [path]: change })).
//     reduce((prev, curr) => ({ ...prev, ...curr }));
//   return pathChanges;
// }

export function changesetToPathChanges(
  changeset: Changeset<any>,
): PathChanges {
  const changes: PathChanges = {};
  for (const [path, change] of Object.entries(changeset)) {
    if (change.newValue === null && change.oldValue === null) {
      throw new Error("Encountered a non-change in a changeset");
    } else if (change.newValue === null && change.oldValue !== null) {
      changes[path] = 'removed';
    } else if (change.newValue !== null && change.oldValue === null) {
      changes[path] = 'added';
    } else if (change.newValue !== change.oldValue) {
      changes[path] = 'modified';
    }
  }
  return changes;
}


// Below, datasetDir is expected to be normalized (no leading slash).

export function normalizeDatasetDir(datasetDir: string) {
  return stripTrailingSlash(stripLeadingSlash(datasetDir));
}

export function getLoadedDataset(
  workDir: string,
  datasetDir: string,
): Datasets.Util.LoadedDataset {
  const ds = datasets[workDir]?.[datasetDir];
  if (!ds) {
    console.error("Dataset does not exist or is not loaded", datasetDir);
    throw new Error("Dataset does not exist or is not loaded");
  }
  return ds;
}


// Indexes

export async function fillInDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
  force = false,
) {

  const defaultIndexStatusReporter = getDefaultIndexStatusReporter(workDir, datasetDir);

  console.debug("Datasets: fillInDefaultIndex: Starting", workDir, datasetDir);

  defaultIndexStatusReporter({
    objectCount: 0,
    progress: {
      phase: 'counting',
      total: 0,
      loaded: 0,
    },
  });

  let changedCount: number = 0;
  let totalCount: number = 0;

  index.completionPromise = (async () => {
    // Collect object paths
    const objectPaths =
      listObjectPaths(listDescendantPaths(path.join(workDir, datasetDir)));
    for await (const objectPath of objectPaths) {
      defaultIndexStatusReporter({
        objectCount: totalCount,
        progress: {
          phase: 'counting',
          total: changedCount,
          loaded: 0,
        },
      });
      if (!force) {
        try {
          await index.dbHandle.get(objectPath);
        } catch (e) {
          if (e.type === 'NotFoundError') {
            await index.dbHandle.put(objectPath, false);
            changedCount += 1;
          }
        }
      } else {
        await index.dbHandle.put(objectPath, false);
      }
      totalCount += 1;
    }

    defaultIndexStatusReporter({
      objectCount: totalCount,
      progress: {
        phase: 'counting',
        total: changedCount,
        loaded: 0,
      },
    });

    console.debug("Datasets: fillInDefaultIndex: Read objects total", changedCount);

    async function* objectPathsToBeIndexed(): AsyncGenerator<string> {
      for await (const data of index.dbHandle.createReadStream()) {
        const { key, value } = data as unknown as { key: string, value: Record<string, any> | false };
        if (value === false) {
          yield key;
        }
      }
    }

    console.debug("Datasets: fillInDefaultIndex: Updating default index", workDir, datasetDir);

    defaultIndexStatusReporter({
      objectCount: totalCount,
      progress: {
        phase: 'indexing',
        total: changedCount,
        loaded: 0,
      },
    });

    function updater(count: number) {
      defaultIndexStatusReporter({
        objectCount: totalCount,
        progress: {
          phase: 'indexing',
          total: changedCount,
          loaded: count,
        },
      });
    }
    const updaterDebounced = throttle(100, true, updater);

    await updateDefaultIndex(
      workDir,
      datasetDir,
      index,
      objectPathsToBeIndexed(),
      updaterDebounced);

    defaultIndexStatusReporter({
      objectCount: totalCount,
    });

    return true as const;

  })();

  await index.completionPromise;
}

async function fillInFilteredIndex(
  defaultIndex: Datasets.Util.DefaultIndex,
  filteredIndex: Datasets.Util.FilteredIndex,
  statusReporter: (index: IndexStatus) => void
) {
  const defaultIndexDB = defaultIndex.dbHandle;
  const filteredIndexDB = filteredIndex.dbHandle;
  const predicate = filteredIndex.predicate;

  if (defaultIndex.status.progress) {
    console.debug("Datasets: fillInFilteredIndex: Awaiting default index progress to finish...");
    await defaultIndex.completionPromise;
    //await new Promise<void>((resolve, reject) => {
    //  defaultIndex.statusSubject.subscribe(
    //    (val) => { if (val.progress === undefined) { resolve() } },
    //    (err) => reject(err),
    //    () => reject("Default index status stream completed without progress having finished"));
    //});
    console.debug("Datasets: fillInFilteredIndex: Awaiting default index progress to finish: Done");
  } else {
    console.debug("Datasets: fillInFilteredIndex: Default index is ready beforehand");
  }

  const total = defaultIndex.status.objectCount;

  console.debug("Datasets: fillInFilteredIndex: Operating on objects from default index", total);

  statusReporter({
    objectCount: 0,
    progress: {
      phase: 'indexing',
      total,
      loaded: 0,
    },
  });

  function updater(indexed: number, loaded: number) {
    statusReporter({
      objectCount: indexed,
      progress: {
        phase: 'indexing',
        total,
        loaded,
      },
    });
  }
  const updaterDebounced = throttle(100, true, updater);

  let indexed: number = 0;
  let loaded: number = 0;
  for await (const data of defaultIndexDB.createReadStream()) {
    // TODO: [upstream] NodeJS.ReadableStream is poorly typed.
    const { key, value } = data as unknown as { key: string, value: Record<string, any> };
    const objectPath: string = key;
    const objectData: Record<string, any> = value;

    //console.debug("Datasets: fillInFilteredIndex: Checking object", loaded, objectPath);
    await new Promise((resolve) => setTimeout(resolve, 5));

    if (predicate(objectPath, objectData) === true) {
      //console.debug("Datasets: fillInFilteredIndex: Checking object: Matches!");
      filteredIndexDB.put(indexed, objectPath);
      indexed += 1;
    }
    loaded += 1;

    updaterDebounced(indexed, loaded);
  }

  statusReporter({
    objectCount: indexed,
  });

  console.debug("Datasets: fillInFilteredIndex: Indexed vs. checked", indexed, loaded);
}

function createFilteredIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
  indexID: string,
  predicate: Datasets.Util.FilteredIndexPredicate,
): Datasets.Util.FilteredIndex {
  const codecOptions: CodecOptions = {
    keyEncoding: {
      type: 'lexicographic-integer',
      encode: (n) => lexint.pack(n, 'hex'),
      decode: lexint.unpack,
      buffer: false,
    },
    valueEncoding: 'string',
  };
  const idx: Datasets.Util.FilteredIndex = {
    ...makeIdxStub(workDir, datasetDir, indexID, codecOptions),
    accessed: new Date(),
    predicate,
  };
  datasets[workDir][datasetDir].indexes[indexID] = idx;
  return idx;
}

export function getFilteredIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
  indexID: string,
): Datasets.Util.FilteredIndex {
  const ds = getLoadedDataset(workDir, datasetDir);
  const idx = ds.indexes[indexID] as Datasets.Util.FilteredIndex | undefined;
  if (!idx) {
    log.error("Unable to get filtered index", datasetDir, indexID)
    throw new Error("Unable to get filtered index");
  }
  return idx;
}

async function createDefaultIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
): Promise<Datasets.Util.DefaultIndex> {
  const { workers: { reader } } = getLoadedRepository(workDir);
  const { commitHash } = await reader.repo_getCurrentCommit({ workDir });
  const codecOptions = {
    keyEncoding: 'string',
    valueEncoding: 'json',
  };
  const idx: Datasets.Util.DefaultIndex = {
    ...makeIdxStub(workDir, datasetDir, 'default', codecOptions),
    commitHash,
  };

  //idx.statusSubject.subscribe(status => {
  //  idx.status = status;
  //});

  datasets[workDir][datasetDir].indexes['default'] = idx;
  return idx;
}

export async function getDefaultIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
): Promise<Datasets.Util.DefaultIndex> {
  const ds = getLoadedDataset(workDir, datasetDir);

  const idx = ds.indexes['default'] as Datasets.Util.DefaultIndex | undefined;

  if (!idx) {
    throw new Error("Unable to get default index");
  }

  const { workers: { reader } } = getLoadedRepository(workDir);
  const { commitHash: oidCurrent } = await reader.repo_getCurrentCommit({ workDir });

  if (idx.commitHash !== oidCurrent) {
    // If default index was created against an older commit hash,
    // let’s try to rebuild it on the fly.

    const { changedObjectPaths } = await resolveDatasetChanges({
      workDir,
      datasetDir,
      oidBefore: idx.commitHash,
      oidAfter: oidCurrent,
    });

    log.debug("Updating default dataset", idx.commitHash, oidCurrent);

    await updateIndexes(
      workDir,
      datasetDir,
      idx,
      changedObjectPaths,
      idx.commitHash,
      oidCurrent,
    );
  }

  return idx;
}

function makeIdxStub(workDir: string, datasetDir: string, indexID: string, codecOptions: CodecOptions):
Datasets.Util.ActiveDatasetIndex<any, any> {
  const ds = getLoadedDataset(workDir, datasetDir); 
  const cacheRoot = ds.indexDBRoot;

  const dbPath = path.join(cacheRoot, hash(`${workDir}/${datasetDir}/${indexID}`));
  const idx: Datasets.Util.ActiveDatasetIndex<any, any> = {
    status: { objectCount: 0 },
    completionPromise: (async () => true as const)(),
    //statusSubject: new Subject<IndexStatus>(), 
    dbHandle: levelup(encode(leveldown(dbPath), codecOptions)),
    accessed: new Date(),
  };

  return idx;
}


// Index status reporters

function getFilteredIndexStatusReporter(workingCopyPath: string, datasetPath: string, indexID: string) {
  const { indexes } = getLoadedDataset(workingCopyPath, datasetPath);
  return function reportFilteredIndexStatus(status: IndexStatus) {
    indexes[indexID].status = status;
    indexStatusChanged.main!.trigger({
      workingCopyPath,
      datasetPath,
      indexID,
      status,
    });
  }
}

function getDefaultIndexStatusReporter(workingCopyPath: string, datasetPath: string) {
  const { indexes } = getLoadedDataset(workingCopyPath, datasetPath);
  return function reportFilteredIndexStatus(status: IndexStatus) {
    indexes['default'].status = status;
    indexStatusChanged.main!.trigger({
      workingCopyPath,
      datasetPath,
      status,
    });
  }
}
