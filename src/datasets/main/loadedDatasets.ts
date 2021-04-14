import path from 'path';
import * as R from 'ramda';
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
import { indexStatusChanged } from '../ipc';
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
    console.info("Worker: Datasets: Load: Already loaded!", workDir, normalizedDatasetDir);

  } catch (e) {
    console.info("Worker: Datasets: Load: Unloading first to clean up", workDir, normalizedDatasetDir);

    await unload({ workDir, datasetDir });

    datasets[workDir] ||= {};
    datasets[workDir][normalizedDatasetDir] = {
      indexDBRoot: cacheRoot,
      indexes: {},
    };

    const defaultIndex: Datasets.Util.DefaultIndex = createIndex(
      workDir,
      normalizedDatasetDir,
      'default',
      {
        keyEncoding: 'string',
        valueEncoding: 'json',
      },
    );

    datasets[workDir][normalizedDatasetDir].indexes.default = defaultIndex,

    console.info("Worker: Datasets: Load: Initialized dataset in-memory structure and default index", workDir, normalizedDatasetDir);

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
  console.info("Worker: Datasets: Unloaded", workDir, datasetDir)
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
    getIndex(workDir, normalizedDatasetDir);

  if (defaultIndex.status.progress) {
    console.debug("Worker: Datasets: getOrCreateFilteredIndex: Awaiting default index progress to finish...");
    await defaultIndex.completionPromise;
    //await new Promise<void>((resolve, reject) => {
    //  defaultIndex.statusSubject.subscribe(
    //    (val) => { if (val.progress === undefined) { resolve() } },
    //    (err) => reject(err),
    //    () => reject("Default index status stream completed without progress having finished"));
    //});
    console.debug("Worker: Datasets: getOrCreateFilteredIndex: Awaiting default index progress to finish: Done");
  } else {
    console.debug("Worker: Datasets: getOrCreateFilteredIndex: Default index is ready beforehand");
  }

  const filteredIndexID = hash(queryExpression); // XXX

  console.debug(
    `Worker: Datasets: getOrCreateFilteredIndex: Creating ${datasetDir} index from ${defaultIndex.status.objectCount} items based on query`,
    queryExpression,
    filteredIndexID);

  let filteredIndex: Datasets.Util.FilteredIndex;
  try {

    filteredIndex = getIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
    ) as Datasets.Util.FilteredIndex;

    console.debug("Worker: Datasets: getOrCreateFilteredIndex: Already exists");

  } catch (e) {

    console.debug("Worker: Datasets: getOrCreateFilteredIndex: Creating");

    filteredIndex = createIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
      {
        keyEncoding: {
          type: 'lexicographic-integer',
          encode: (n) => lexint.pack(n, 'hex'),
          decode: lexint.unpack,
          buffer: false,
        },
        valueEncoding: 'string',
      },
    ) as Datasets.Util.FilteredIndex;

    let predicate: Datasets.Util.FilteredIndexPredicate;
    try {
      predicate = new Function('objPath', 'obj', queryExpression) as Datasets.Util.FilteredIndexPredicate;
    } catch (e) {
      throw new Error("Unable to parse submitted predicate expression");
    }

    filteredIndex.predicate = predicate;

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
  const idx = getIndex(workDir, normalizedDatasetDir, indexID);
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
  const idx = getIndex(
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
  const idx = getIndex(
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
  oidBefore: string
  oidAfter: string
}) => Promise<{
  changedBuffers: PathChanges
  changedObjects: {
    [datasetDir: string]: PathChanges
  }
}> = async function ({
  workDir,
  oidBefore,
  oidAfter,
}) {
  const { workers: { sync } } = getLoadedRepository(workDir);
  // Find which buffers were added/removed/modified
  const { changedBuffers } = await sync.repo_resolveChanges({
    rootPath: '/',
    workDir,
    oidBefore,
    oidAfter,
  });

  const bufferPathChanges = changedPathsToPathChanges(changedBuffers);

  // Calculate affected objects in datasets
  const changedBuffersPerDataset:
  { [datasetDir: string]: [ path: string, change: ChangeStatus ][] } =
    R.map(() => [], datasets[workDir] || {});

  for (const [bufferPath, changeStatus] of changedBuffers) {
    const datasetDir = bufferPath.split(path.posix.sep)[0];

    if (datasets[workDir]?.[datasetDir]) {
      const datasetRelativeBufferPath = path.relative(`/${datasetDir}`, bufferPath);
      changedBuffersPerDataset[datasetDir].push([
        datasetRelativeBufferPath,
        changeStatus,
      ]);
    }
  }

  async function* getChangedPaths(changes: [ string, ChangeStatus ][]) {
    for (const [p, _] of changes) {
      yield p;
    }
  }

  const objectPathChanges: { [datasetDir: string]: PathChanges } = {};

  for (const [changedDatasetDir, changes] of Object.entries(changedBuffersPerDataset)) {
    const pathChanges = changedPathsToPathChanges(changes);
    const objectPaths = listObjectPaths(getChangedPaths(changes));

    objectPathChanges[changedDatasetDir] = pathChanges;

    await updateIndexes(
      workDir,
      changedDatasetDir,
      objectPaths,
      oidBefore,
      oidAfter);
  }

  return {
    changedBuffers: bufferPathChanges,
    changedObjects: objectPathChanges,
  };
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


// Events

async function updateIndexes(
  workDir: string,
  datasetDir: string,
  changedObjectPaths: AsyncGenerator<string>,
  oid1: string,
  oid2: string,
) {
  const ds = getLoadedDataset(workDir, datasetDir);
  const defaultIndex: Datasets.Util.DefaultIndex = getIndex(workDir, datasetDir);
  const affectedFilteredIndexes: [idx: Datasets.Util.FilteredIndex, idxID: string][] = [];

  const { workers: { sync } } = getLoadedRepository(workDir);

  const filteredIndexIDsToCheck: string[] =
    Object.keys(ds.indexes).filter(k => k !== 'default');

  const defaultIdxDB = defaultIndex.dbHandle;

  async function readObjectVersions(objectPath: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    const rule = findSerDesRuleForPath(objectPath);
    return [
      rule.deserialize(await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oid1 }), {}),
      rule.deserialize(await sync.repo_readBuffersAtVersion({ workDir, rootPath: path.join(datasetDir, objectPath), commitHash: oid2 }), {}),
    ];
  }

  // Update default index and infer which filtered indexes are affected
  for await (const objectPath of changedObjectPaths) {
    // Read “before” and “after” object versions
    const [objv1, objv2] = await readObjectVersions(objectPath);

    // Update or delete structured object data in default index
    if (objv2 !== null) {
      // Object was changed or added
      defaultIdxDB.put(objectPath, objv2);
    } else {
      // Object was deleted
      try {
        defaultIdxDB.del(objectPath);
      } catch (e) {
        if (e.type === 'NotFoundError') {
          // (or even never existed)
        } else {
          throw e;
        }
      }
    }

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
    //console.debug("Worker: Datasets: updateDefaultIndex: Reading...", objectPath);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const obj = await readObjectCold(workDir, path.join(datasetDir, objectPath));

    if (obj !== null) {
      await index.dbHandle.put(objectPath, obj);
      //console.debug("Worker: Datasets: updateDefaultIndex: Indexed", objectPath, obj ? Object.keys(obj) : null);
    } else {
      try {
        await index.dbHandle.del(objectPath);
        //console.debug("Worker: Datasets: updateDefaultIndex: Deleted", objectPath);
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

function changedPathsToPathChanges(
  changedPaths: [path: string, change: ChangeStatus][]
): PathChanges {
  const pathChanges: PathChanges = changedPaths.
    map(([path, change]) => ({ [path]: change })).
    reduce((prev, curr) => ({ ...prev, ...curr }));
  return pathChanges;
}

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

function getLoadedDataset(
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

export function getIndex<K, V>(
  workDir: string,
  datasetDir: string,
  indexID?: string,
): Datasets.Util.ActiveDatasetIndex<K, V> {
  const ds = getLoadedDataset(workDir, datasetDir);
  let idx: Datasets.Util.ActiveDatasetIndex<K, V>;
  if (indexID) {
    idx = ds.indexes[indexID];
  } else {
    idx = ds.indexes['default'];
  }
  if (!idx) {
    throw new Error("Unable to get dataset index");
  }
  return idx;
}

async function fillInDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
) {

  function defaultIndexStatusReporter(status: IndexStatus) {
    index.status = status;
    indexStatusChanged.main!.trigger({
      workingCopyPath: workDir,
      datasetPath: datasetDir,
      status,
    });
  }

  console.debug("Worker: Datasets: fillInDefaultIndex: Starting", workDir, datasetDir);

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
      try {
        await index.dbHandle.get(objectPath);
      } catch (e) {
        if (e.type === 'NotFoundError') {
          await index.dbHandle.put(objectPath, false);
          changedCount += 1;
        }
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

    console.debug("Worker: Datasets: fillInDefaultIndex: Read objects total", changedCount);

    async function* objectPathsToBeIndexed(): AsyncGenerator<string> {
      for await (const data of index.dbHandle.createReadStream()) {
        const { key, value } = data as unknown as { key: string, value: Record<string, any> | false };
        if (value === false) {
          yield key;
        }
      }
    }

    console.debug("Worker: Datasets: fillInDefaultIndex: Updating default index", workDir, datasetDir);

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

  const total = defaultIndex.status.objectCount;

  console.debug("Worker: Datasets: fillInFilteredIndex: Operating on objects from default index", total);

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

    //console.debug("Worker: Datasets: fillInFilteredIndex: Checking object", loaded, objectPath);
    await new Promise((resolve) => setTimeout(resolve, 5));

    if (predicate(objectPath, objectData) === true) {
      //console.debug("Worker: Datasets: fillInFilteredIndex: Checking object: Matches!");
      filteredIndexDB.put(indexed, objectPath);
      indexed += 1;
    }
    loaded += 1;

    updaterDebounced(indexed, loaded);
  }

  statusReporter({
    objectCount: indexed,
  });

  console.debug("Worker: Datasets: fillInFilteredIndex: Indexed vs. checked", indexed, loaded);
}

function createIndex<K, V>(
  workDir: string,
  datasetDir: string,
  indexID: string,
  codecOptions: CodecOptions,
): Datasets.Util.ActiveDatasetIndex<K, V> {
  const ds = getLoadedDataset(workDir, datasetDir); 
  const cacheRoot = ds.indexDBRoot;

  const dbPath = path.join(cacheRoot, hash(`${workDir}/${datasetDir}/${indexID}`));
  const idx: Datasets.Util.ActiveDatasetIndex<K, V> = {
    status: { objectCount: 0 },
    completionPromise: (async () => true as const)(),
    //statusSubject: new Subject<IndexStatus>(), 
    dbHandle: levelup(encode(leveldown(dbPath), codecOptions)),
  };

  //idx.statusSubject.subscribe(status => {
  //  idx.status = status;
  //});

  datasets[workDir][datasetDir].indexes[indexID] = idx;
  return idx;
}


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
