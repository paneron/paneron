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
import { filteredIndexUpdated, indexStatusChanged, objectsChanged } from '../ipc';
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
    log.info("Datasets: Load: Already loaded", workDir, normalizedDatasetDir);

  } catch (e) {
    log.info("Datasets: Load: Unloading first to clean up", workDir, normalizedDatasetDir);

    await unload({ workDir, datasetDir });

    datasets[workDir] ||= {};
    datasets[workDir][normalizedDatasetDir] = {
      indexDBRoot: cacheRoot,
      indexes: {},
    };

    await initDefaultIndex(
      workDir,
      normalizedDatasetDir,
    );

    log.info("Datasets: Load: Initialized dataset in-memory structure and default index", workDir, normalizedDatasetDir);
  }
}


const unload: Datasets.Lifecycle.Unload = async function ({
  workDir,
  datasetDir,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  try {
    const ds = getLoadedDataset(workDir, normalizedDatasetDir);
    for (const [idxID, { dbHandle, sortedDBHandle }] of Object.entries(ds.indexes)) {
      try {
        await dbHandle.close();
      } catch (e) {
        log.error("Datasets: unload(): Failed to close DB handle", idxID, datasetDir, workDir, e);
      }
      if (sortedDBHandle) {
        try {
          await sortedDBHandle.close();
        } catch (e) {
          log.error("Datasets: unload(): Failed to close filtered index sorted DB handle", idxID, datasetDir, workDir, e);
        }
      }
      //statusSubject.complete();
    }
  } catch (e) {
    log.error("Failed to unload dataset", e, workDir, datasetDir);
  }
  delete datasets[workDir]?.[datasetDir];
  log.info("Datasets: Unloaded", workDir, datasetDir)
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
  keyExpression,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  const filteredIndexID = hash(queryExpression); // XXX

  try {

    getFilteredIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
    ) as Datasets.Util.FilteredIndex;

    log.debug("Datasets: getOrCreateFilteredIndex: Already exists");

  } catch (e) {

    log.debug("Datasets: getOrCreateFilteredIndex: Creating");

    let predicate: Datasets.Util.FilteredIndexPredicate;
    try {
      predicate = new Function('objPath', 'obj', queryExpression) as Datasets.Util.FilteredIndexPredicate;
    } catch (e) {
      log.error("Unable to parse submitted predicate expression", queryExpression, e);
      throw new Error("Unable to parse submitted predicate expression");
    }

    let keyer: Datasets.Util.FilteredIndexKeyer | undefined;
    if (keyExpression) {
      try {
        keyer = new Function('obj', keyExpression) as Datasets.Util.FilteredIndexKeyer;
      } catch (e) {
        log.error("Unable to parse sorter expression", keyExpression, e);
        throw new Error("Unable to parse sorter expression");
      }
    } else {
      keyer = undefined;
    }

    await initFilteredIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
      predicate,
      keyer,
    ) as Datasets.Util.FilteredIndex;
  }

  return { indexID: filteredIndexID };
}


const describeIndex: ReturnsPromise<Datasets.Indexes.Describe> = async function ({
  workDir,
  datasetDir,
  indexID,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  let idx: Datasets.Util.ActiveDatasetIndex<any>;
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
  const db = idx.sortedDBHandle;
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
  const db = idx.sortedDBHandle;

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


/* Given paths, reads objects from filesystem into the index. */
async function _writeDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
  changedObjectPathGenerator: AsyncGenerator<string>,
  statusReporter: (indexedItemCount: number) => void,
) {
  let loaded: number = 0;

  for await (const objectPath of changedObjectPathGenerator) {
    //log.debug("Datasets: updateDefaultIndex: Reading...", objectPath);
    //await new Promise((resolve) => setTimeout(resolve, 15));

    loaded += 1;
    statusReporter(loaded);

    const obj = await readObjectCold(workDir, path.join(datasetDir, objectPath));

    if (obj !== null) {
      await index.dbHandle.put(objectPath, obj);
      //log.debug("Datasets: updateDefaultIndex: Indexed", objectPath, obj ? Object.keys(obj) : null);
    } else {
      try {
        await index.dbHandle.del(objectPath);
        //log.debug("Datasets: updateDefaultIndex: Deleted", objectPath);
      } catch (e) {
        if (e.type !== 'NotFoundError') {
          throw e;
        }
      }
    }
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
    log.error("Dataset does not exist or is not loaded", datasetDir);
    throw new Error("Dataset does not exist or is not loaded");
  }
  return ds;
}


// Indexes

/* Writes default index from scratch. */
export async function fillInDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
) {

  const defaultIndexStatusReporter = getDefaultIndexStatusReporter(workDir, datasetDir);

  log.debug("Datasets: fillInDefaultIndex: Starting", workDir, datasetDir);

  defaultIndexStatusReporter({
    objectCount: 0,
    progress: {
      phase: 'counting',
      total: 0,
      loaded: 0,
    },
  });

  function counterStatusReporter(counted: number) {
    defaultIndexStatusReporter({
      objectCount: counted,
      progress: {
        phase: 'counting',
        total: counted,
        loaded: 0,
      },
    });
  }
  const counterStatusReporterDebounced = throttle(100, true, counterStatusReporter);

  let totalCount: number = 0;

  index.completionPromise = (async () => {

    await indexMeta(index, null);

    const repoCommit = await getCurrentCommit(workDir);

    // Collect object paths
    const objectPaths =
      listObjectPaths(listDescendantPaths(path.join(workDir, datasetDir)));

    for await (const objectPath of objectPaths) {
      counterStatusReporterDebounced(totalCount);
      await index.dbHandle.put(objectPath, false);
      totalCount += 1;
    }

    defaultIndexStatusReporter({
      objectCount: totalCount,
      progress: {
        phase: 'counting',
        total: totalCount,
        loaded: 0,
      },
    });

    log.debug("Datasets: fillInDefaultIndex: Read objects total", totalCount);

    async function* objectPathsToBeIndexed(): AsyncGenerator<string> {
      for await (const data of index.dbHandle.createReadStream()) {
        const { key, value } = data as unknown as { key: string, value: Record<string, any> | false };
        if (key !== INDEX_META_MARKER_DB_KEY && value === false) {
          yield key;
        }
      }
    }

    log.debug("Datasets: fillInDefaultIndex: Updating default index", workDir, datasetDir);

    defaultIndexStatusReporter({
      objectCount: totalCount,
      progress: {
        phase: 'indexing',
        total: totalCount,
        loaded: 0,
      },
    });

    function loadedStatusReporter(loaded: number) {
      defaultIndexStatusReporter({
        objectCount: totalCount,
        progress: {
          phase: 'indexing',
          total: totalCount,
          loaded,
        },
      });
    }

    await _writeDefaultIndex(
      workDir,
      datasetDir,
      index,
      objectPathsToBeIndexed(),
      throttle(100, true, loadedStatusReporter));

    await indexMeta(index, {
      completed: new Date(),
      commitHash: repoCommit,
      objectCount: totalCount,
    });

    defaultIndexStatusReporter({
      objectCount: totalCount,
    });

    index.completionPromise = undefined;

    return true as const;

  })();

  await index.completionPromise;
}


/* Fills in filtered index from scratch. */
async function fillInFilteredIndex(
  defaultIndex: Datasets.Util.DefaultIndex,
  filteredIndex: Datasets.Util.FilteredIndex,
  statusReporter: (index: IndexStatus) => void,
) {
  const defaultIndexDB = defaultIndex.dbHandle;
  const filteredIndexKeyedDB = filteredIndex.dbHandle;
  const predicate = filteredIndex.predicate;
  const keyer = filteredIndex.keyer;

  if (filteredIndex.completionPromise) {
    await filteredIndex.completionPromise;
  }

  filteredIndex.completionPromise = (async () => {

    if (defaultIndex.completionPromise) {
      log.debug("Datasets: fillInFilteredIndex: Awaiting default index progress to finish...");
      await defaultIndex.completionPromise;
      //await new Promise<void>((resolve, reject) => {
      //  defaultIndex.statusSubject.subscribe(
      //    (val) => { if (val.progress === undefined) { resolve() } },
      //    (err) => reject(err),
      //    () => reject("Default index status stream completed without progress having finished"));
      //});
      log.debug("Datasets: fillInFilteredIndex: Awaiting default index progress to finish: Done");
    } else {
      log.debug("Datasets: fillInFilteredIndex: Default index is ready beforehand");
    }

    const commitHash = (await indexMeta(defaultIndex))?.commitHash;

    if (!commitHash) {
      log.error("Datasets: fillInFilteredIndex: Default index doesn’t specify a commit hash, aborting");
      throw new Error("Unable to fill in filtered index: default index doesn’t specify a commit hash");
    }

    await indexMeta(filteredIndex, null);

    const total = defaultIndex.status.objectCount;

    log.debug("Datasets: fillInFilteredIndex: Operating on objects from default index", total);

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

    // First pass: write items into a temp. DB that orders on read
    for await (const data of defaultIndexDB.createReadStream()) {
      // TODO: [upstream] NodeJS.ReadableStream is poorly typed.
      const { key, value } = data as unknown as { key: string, value: Record<string, any> };
      if (key !== INDEX_META_MARKER_DB_KEY) {
        updaterDebounced(indexed, Math.floor(loaded));

        const objectPath: string = key;
        const objectData: Record<string, any> = value;

        //log.debug("Datasets: fillInFilteredIndex: Checking object", loaded, objectPath);
        //await new Promise((resolve) => setTimeout(resolve, 5));

        if (predicate(objectPath, objectData) === true) {
          //log.debug("Datasets: fillInFilteredIndex: Checking object using keyer", keyer);
          const customKey = (keyer ? keyer(objectData) : null) ?? key;
          await filteredIndexKeyedDB.put(customKey, objectPath);
          indexed += 1;
        }
        loaded += 0.5;
      }
    }

    await rebuildFilteredIndexSortedDB(
      filteredIndex,
      (item) => updaterDebounced(indexed, Math.floor(loaded + (item * 0.5))));

    await indexMeta(filteredIndex, {
      commitHash,
      completed: new Date(),
      objectCount: indexed,
    });

    filteredIndex.completionPromise = undefined;

    statusReporter({
      objectCount: indexed,
    });

    log.debug("Datasets: fillInFilteredIndex: Indexed vs. checked", indexed, loaded);

    return true as const;
  })();

  await filteredIndex.completionPromise;
}


async function getCurrentCommit(workDir: string): Promise<string> {
  const { workers: { reader } } = getLoadedRepository(workDir);
  const { commitHash } = await reader.repo_getCurrentCommit({ workDir });
  return commitHash;
}


async function initFilteredIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
  indexID: string,
  predicate: Datasets.Util.FilteredIndexPredicate,
  keyer?: Datasets.Util.FilteredIndexKeyer,
): Promise<Datasets.Util.FilteredIndex> {
  const ds = getLoadedDataset(workDir, datasetDir); 

  const cacheRoot = ds.indexDBRoot;

  const defaultIndex = await getDefaultIndex(workDir, datasetDir);

  const idx: Datasets.Util.FilteredIndex = {
    ...makeIdxStub(workDir, datasetDir, indexID, {
      keyEncoding: 'string',
      valueEncoding: 'string',
    }),
    sortedDBHandle: levelup(encode(leveldown(getDBPath(cacheRoot, `${workDir}/${datasetDir}/${indexID}-sorted`)), {
      keyEncoding: {
        type: 'lexicographic-integer',
        encode: (n) => lexint.pack(n, 'hex'),
        decode: lexint.unpack,
        buffer: false,
      },
      valueEncoding: 'string',
    })),
    accessed: new Date(),
    predicate,
    keyer,
  };

  datasets[workDir][datasetDir].indexes[indexID] = idx;

  const meta = await indexMeta(idx);
  if (!meta || !meta.commitHash || !meta.completed) {
    await idx.dbHandle.clear();
    const statusReporter = getFilteredIndexStatusReporter(workDir, datasetDir, indexID);

    // This will proceed in background.
    fillInFilteredIndex(defaultIndex, idx, statusReporter);
  } else {
    idx.status = {
      objectCount: meta.objectCount,
    };
  }

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


async function initDefaultIndex(
  workDir: string,
  datasetDir: string, // Should be normalized.
): Promise<Datasets.Util.DefaultIndex> {
  const codecOptions = {
    keyEncoding: 'string',
    valueEncoding: 'json',
  };
  const idx: Datasets.Util.DefaultIndex = {
    ...makeIdxStub(workDir, datasetDir, 'default', codecOptions),
  };

  datasets[workDir][datasetDir].indexes['default'] = idx;

  const meta = await indexMeta(idx);
  if (!meta || !meta.commitHash || !meta.completed) {
    await idx.dbHandle.clear();

    // Will proceed in the background:
    fillInDefaultIndex(workDir, datasetDir, idx);
  } else {
    idx.status = {
      objectCount: meta.objectCount,
    };
    getDefaultIndexStatusReporter(workDir, datasetDir)(idx.status);
  }

  //idx.statusSubject.subscribe(status => {
  //  idx.status = status;
  //});
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

  // updateDatasetIndexesIfNeeded(
  //   workDir,
  //   datasetDir,
  // );

  return idx;
}


// Index status reporters.
// TODO: Make index status reporters async?

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
  return function reportDefaultIndexStatus(status: IndexStatus) {
    indexes['default'].status = status;
    indexStatusChanged.main!.trigger({
      workingCopyPath,
      datasetPath,
      status,
    });
  }
}


// Commit hash signifies which version of the repository the index in question was built against.
// If, upon any index access, its has doesn’t match the current HEAD commit hash as reported by Git,
// indexes are updated.
// This also happens each time a new commit was added to the repository.
// Upon index update, frontend is notified.
//
// Index updates happen as follows:
//
// 1) file paths changed between current Git HEAD commit and commit stored in index DB are calculated
// 2) for each changed path, depending on type of change,
//    a record in default index is added/deleted/replaced with deserialized object data
// 3) at the same time, if object data for that path matches any filtered index’s predicate,
//    filtered index’s keyed DB is updated in the same way
// 4) affected filtered indexes’ sorted DBs are rebuilt from their respective keyed DBs
//
// Once index is being rebuilt, further rebuilds are skipped until the update is complete.
//
// TODO: Should concurrent index updates be skipped or queued?
// On one hand
//
// Below are low-level utilities for retrieving/setting commit hashes
// from/in default index’s DBs and filtered index’s keyed DBs.

const INDEX_META_MARKER_DB_KEY: string = '**meta';

/* Fetch or update index metadata. */
async function indexMeta(
    idx: Datasets.Util.ActiveDatasetIndex<any>,
    newMeta?: Datasets.Util.IndexMeta | null,
): Promise<Datasets.Util.IndexMeta | null> {
  let meta: Datasets.Util.IndexMeta | null ;

  try {
    meta = (await idx.dbHandle.get(
      INDEX_META_MARKER_DB_KEY,
      { valueEncoding: 'json' },
    ) as Datasets.Util.IndexMeta | null) || null;
  } catch (e) {
    if (e.type === 'NotFoundError') {
      meta = null;
    } else {
      throw e;
    }
  }

  if (newMeta !== undefined) {
    if (newMeta !== null) {
      await idx.dbHandle.put(
        INDEX_META_MARKER_DB_KEY,
        newMeta,
        { valueEncoding: 'json' });
    } else {
      try {
        await idx.dbHandle.del(INDEX_META_MARKER_DB_KEY);
      } catch (e) {}

    }
  }

  return meta || newMeta || null;
}


/* TODO: implement. Call periodically to prevent filtered indexes from accumulating. */
// async function pruneUnusedFilteredIndexes(ds: Datasets.Util.LoadedDataset) {
// }


/* Updates default index and any affected filtered indexes. Notifies the UI.
   To be called when */
export async function updateDatasetIndexesIfNeeded(
  workDir: string,
  datasetDir: string, // Should be normalized.
) {
  const ds = getLoadedDataset(workDir, datasetDir);
  const affectedFilteredIndexes: { [idxID: string]: { idx: Datasets.Util.FilteredIndex, newObjectCount: number } } = {};

  const defaultIndex = ds.indexes['default'];
  const defaultIdxDB = defaultIndex.dbHandle;

  const workers = getLoadedRepository(workDir).workers;

  // Do nothing if default index is already being rebuilt.
  if (defaultIndex.completionPromise) {
    log.debug("updateDatasetIndexesIfNeeded: Skipping (default index busy)");
    return;
  }

  log.debug("updateDatasetIndexesIfNeeded: Starting");

  // Check current repository commit hash against default index’s stored commit hash.
  const { reader } = workers;
  const { commitHash: oidCurrent } = await reader.repo_getCurrentCommit({ workDir });
  const defaultIndexMeta = await indexMeta(defaultIndex);
  const oidIndex = defaultIndexMeta?.commitHash;

  // If default index has a commit hash in meta, and it matches repository commit hash, do nothing.
  if (oidIndex && oidIndex === oidCurrent) {
    log.warn("updateDatasetIndexesIfNeeded: not needed; commit hashes (index vs. HEAD)", oidIndex, oidCurrent);
    return;
  }

  if (!defaultIndexMeta || !oidIndex) {
    // TODO: Eventually we can update indexes from nothing,
    // but for now it’s separated across initial “filling in” and subsequent “updates”
    log.error("updateDatasetIndexesIfNeeded: Attempting to update dataset indexes, but default index lacks meta or commit hash");
    throw new Error("Attempting to update dataset indexes, but default index lacks meta or commit hash");
  }

  // A list of all filtered index IDs will be useful soon.
  // NOTE: This excludes filtered indexes that are being processed.
  const filteredIndexIDs: string[] = Object.entries(ds.indexes).
    filter(([id, idx]) => id !== 'default' && !idx.completionPromise).
    map(([id, ]) => id);

  const completionPromise = (async () => {

    // Otherwise, start the process by figuring out which files have changed between index & repo commits.

    log.debug("updateDatasetIndexesIfNeeded: Figuring out what changed between", oidIndex, oidCurrent);

    const { changedObjectPaths } = await resolveDatasetChanges({
      workDir,
      datasetDir,
      oidBefore: oidIndex,
      oidAfter: oidCurrent,
    });

    const { sync } = workers;

    log.debug("updateDatasetIndexesIfNeeded: Updating default index");

    const defaultIndexStatusReporter = getDefaultIndexStatusReporter(workDir, datasetDir);

    let newDefaultIndexObjectCount = defaultIndexMeta.objectCount;

    async function readObjectVersions(objectPath: string):
    Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
      const rule = findSerDesRuleForPath(objectPath);

      const bufDs1 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oidIndex! });
      const bufDs2 = await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oidCurrent });

      const objDs1: Record<string, any> | null = Object.keys(bufDs1).length > 0 ? rule.deserialize(bufDs1, {}) : null;
      const objDs2: Record<string, any> | null = Object.keys(bufDs2).length > 0 ? rule.deserialize(bufDs2, {}) : null;

      if (objDs1 === null && objDs2 === null) {
        log.error("Datasets: updateIndexesIfNeeded: Unable to read either object version", path.join(datasetDir, objectPath), oidIndex, oidCurrent);
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
      log.debug("Datasets: updateDatasetIndexesIfNeeded: Changed object path", objectPath);
      idx += 1;
      const pathAffectsFilteredIndexes: { [id: string]: { idx: Datasets.Util.FilteredIndex } } = {};

      // Read “before” and “after” object versions
      const [objv1, objv2] = await readObjectVersions(objectPath);

      // Check all filtered indexes that have not yet been marked as affected
      for (const idxID of filteredIndexIDs) {
        const idx = ds.indexes[idxID] as Datasets.Util.FilteredIndex;
        // If either object version matches given filtered index’s predicate,
        // mark that index as affected and track object count changes.
        // TODO: Notify frontend about filtered index status.
        if ((objv1 && idx.predicate(objectPath, objv1)) || (objv2 && idx.predicate(objectPath, objv2))) {
          pathAffectsFilteredIndexes[idxID] = {
            idx,
          };
          if (!affectedFilteredIndexes[idxID]) {
            const meta = await indexMeta(idx);
            if (meta) {
              affectedFilteredIndexes[idxID] = {
                idx,
                newObjectCount: meta.objectCount,
              };
            }
          }
        }
      }

      // Update or delete structured object data in default index
      if (objv2 !== null) { // Object was changed or added

        // Add/update object data in default index
        await defaultIdxDB.put(objectPath, objv2);
        if (objv1 === null) { // Object was added
          changes[objectPath] = 'added';

          // Add object path in affected filtered indexes
          for (const [idxID, { idx }] of Object.entries(pathAffectsFilteredIndexes)) {
            const customKey = (idx.keyer ? idx.keyer(objv2) : null) ?? objectPath;
            await idx.dbHandle.put(customKey, objectPath);
            affectedFilteredIndexes[idxID].newObjectCount += 1;
          }
          newDefaultIndexObjectCount += 1;
          defaultIndexStatusReporter({
            objectCount: defaultIndex.status.objectCount + 1,
            progress: {
              phase: 'indexing',
              total: defaultIndex.status.objectCount,
              loaded: idx,
            },
          });
        } else { // Object was changed
          changes[objectPath] = 'modified';

          // Add new key (or object path) to affected filtered indexes,
          // delete old key (if it’s different) from affected filtered indexes
          for (const { idx } of Object.values(pathAffectsFilteredIndexes)) {
            const customKey1 = (idx.keyer ? idx.keyer(objv1) : null) ?? objectPath;
            const customKey2 = (idx.keyer ? idx.keyer(objv2) : null) ?? objectPath;
            await idx.dbHandle.put(customKey2, objectPath);
            if (customKey2 !== customKey1) {
              try {
                await idx.dbHandle.del(customKey1);
              } catch (e) {}
            }
          }
          defaultIndexStatusReporter({
            objectCount: defaultIndex.status.objectCount,
            progress: {
              phase: 'indexing',
              total: defaultIndex.status.objectCount,
              loaded: idx,
            },
          });
        }
      } else { // Object was likely deleted, or never existed
        try {
          changes[objectPath] = 'removed';

          // Delete from default index
          try {
            await defaultIdxDB.del(objectPath);
            newDefaultIndexObjectCount -= 1;
            defaultIndexStatusReporter({
              objectCount: defaultIndex.status.objectCount - 1,
              progress: {
                phase: 'indexing',
                total: defaultIndex.status.objectCount,
                loaded: idx,
              },
            });
          } catch (e) {}

          if (objv1) {
            // If it previously existed, delete key or object path from affected filtered indexes.
            for (const [idxID, { idx }] of Object.entries(pathAffectsFilteredIndexes)) {
              const customKey = (idx.keyer ? idx.keyer(objv1) : null) ?? objectPath;
              try {
                await idx.dbHandle.del(customKey);
                affectedFilteredIndexes[idxID].newObjectCount -= 1;
              } catch (e) {}
            }
          }
        } catch (e) {
          if (e.type === 'NotFoundError') {
            // (or even never existed)
            changes[objectPath] = true;
          } else {
            throw e;
          }
        }
      }
    }

    // Update default & filtered index meta; rebuild filtered index sorted DBs; notify frontend

    await indexMeta(defaultIndex, { commitHash: oidCurrent, completed: new Date(), objectCount: newDefaultIndexObjectCount });
    for (const [indexID, { idx, newObjectCount }] of Object.entries(affectedFilteredIndexes)) {
      await rebuildFilteredIndexSortedDB(idx);
      await indexMeta(idx, { commitHash: oidCurrent, completed: new Date(), objectCount: newObjectCount });
      await filteredIndexUpdated.main!.trigger({ workingCopyPath: workDir, datasetPath: datasetDir, indexID });
      idx.completionPromise = undefined;
    }
    defaultIndex.completionPromise = undefined;

    defaultIndexStatusReporter({
      objectCount: defaultIndex.status.objectCount,
    });

    await objectsChanged.main!.trigger({
      workingCopyPath: workDir,
      datasetPath: datasetDir,
      objects: changes,
    });

    return true as const;

  })();

  defaultIndex.completionPromise = completionPromise;

  for (const idxID of filteredIndexIDs) {
    ds.indexes[idxID].completionPromise = completionPromise;
  }
}


/* Drops and rebuilds filtered index sorted DB from its keyed DB. */
async function rebuildFilteredIndexSortedDB(idx: Datasets.Util.FilteredIndex, onItem?: (obj: number) => void) {
  await idx.sortedDBHandle.clear();
  let key: number = 0;
  for await (const data of idx.dbHandle.createReadStream()) {
    const { value } = data as unknown as { value: string };
    //log.debug("Indexing sorted key", value);
    await idx.sortedDBHandle.put(key, value);

    key += 1;
    onItem?.(key);
  }
}


// Utility functions

function getDBPath(cacheRoot: string, id: string) {
  return path.join(cacheRoot, hash(id));
}


function makeIdxStub(workDir: string, datasetDir: string, indexID: string, codecOptions: CodecOptions):
Datasets.Util.ActiveDatasetIndex<any> {
  const ds = getLoadedDataset(workDir, datasetDir); 
  const cacheRoot = ds.indexDBRoot;

  const dbPath = getDBPath(cacheRoot, `${workDir}/${datasetDir}/${indexID}`);
  const idx: Datasets.Util.ActiveDatasetIndex<any> = {
    status: { objectCount: 0 },
    //statusSubject: new Subject<IndexStatus>(), 
    dbHandle: levelup(encode(leveldown(dbPath), codecOptions)),
    accessed: new Date(),
  };

  return idx;
}
