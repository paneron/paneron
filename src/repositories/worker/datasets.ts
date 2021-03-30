import path from 'path';
import * as R from 'ramda';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import lexint from 'lexicographic-integer';
import { CodecOptions } from 'level-codec';
import { Observable, Subject } from 'threads/observable';

import { IndexStatus } from '@riboseinc/paneron-extension-kit/types/indexes';
import { Changeset, ChangeStatus, PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';
import { SerializableObjectSpec } from '@riboseinc/paneron-extension-kit/types/object-spec';
import { matchesPath } from '@riboseinc/paneron-extension-kit/object-specs';
import getSerDesRule from '@riboseinc/paneron-extension-kit/object-specs/ser-des';

import { hash, stripLeadingSlash, stripTrailingSlash } from 'utils';
import WorkerMethods, { Datasets, Repositories } from './types';
import { listDescendantPaths, listDescendantPathsAtVersion } from './buffers/list';
import { readBuffersAtVersion } from './buffers/read';
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
  objectSpecs,
  cacheRoot,
}) {
  await unload({ workDir, datasetDir });

  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  datasets[workDir] ||= {};
  datasets[workDir][normalizedDatasetDir] = {
    specs: objectSpecs,
    indexDBRoot: cacheRoot,
    indexes: {},
  };

  console.info("Loaded dataset", workDir, normalizedDatasetDir);

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

  console.info("Filling in default index", workDir, normalizedDatasetDir);

  fillInDefaultIndex(workDir, normalizedDatasetDir, defaultIndex, objectSpecs);
}


const unload: Datasets.Lifecycle.Unload = async function ({
  workDir,
  datasetDir,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  try {
    const ds = getLoadedDataset(workDir, normalizedDatasetDir);
    for (const { dbHandle, statusSubject } of Object.values(ds.indexes)) {
      await dbHandle.close();
      statusSubject.complete();
    }
  } catch (e) {
    // TODO: Implement logging in worker
  }
}


const unloadAll: Datasets.Lifecycle.UnloadAll = async function ({
  workDir,
}) {
  for (const datasetDir of Object.keys(datasets[workDir] || {})) {
    await unload({ workDir, datasetDir });
  }
}


const getOrCreateFilteredIndex: WorkerMethods["ds_index_getOrCreateFiltered"] = async function ({
  workDir,
  datasetDir,
  queryExpression,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  const defaultIndex: Datasets.Util.DefaultIndex =
    getIndex(workDir, normalizedDatasetDir);

  const filteredIndexID = hash(queryExpression); // XXX

  let filteredIndex: Datasets.Util.FilteredIndex;
  try {

    filteredIndex = getIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
    ) as Datasets.Util.FilteredIndex;

  } catch (e) {

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

    // This will proceed in background.
    fillInFilteredIndex(defaultIndex, filteredIndex);
  }

  return { indexID: filteredIndexID };
}


const describeIndex: WorkerMethods["ds_index_describe"] = async function ({
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


const streamIndexStatus: WorkerMethods["ds_index_streamStatus"] = async function ({
  workDir,
  datasetDir,
  indexID,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  const idx = getIndex(workDir, normalizedDatasetDir, indexID);
  return Observable.from(idx.statusSubject);
}


const getFilteredObject: Datasets.Indexes.GetFilteredObject = async function ({
  workDir,
  datasetDir,
  indexID,
  position,
}) {
  if (indexID === 'default') {
    throw new Error("Default index is not supported by getIndexedObject");
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


const resolveRepositoryChanges: Repositories.Data.ResolveChanges = async function ({
  workDir,
  oidBefore,
  oidAfter,
}) {
  // Find which buffers were added/removed/modified
  const changedBufferPaths = await listDescendantPathsAtVersion(
    '/',
    workDir,
    oidBefore,
    {
      refToCompare: oidAfter,
      onlyChanged: true,
    },
  ) as [path: string, changeStatus: ChangeStatus][];

  const bufferPathChanges = changedPathsToPathChanges(changedBufferPaths);

  // Calculate affected objects in datasets
  const changedBuffersPerDataset:
  { [datasetDir: string]: [ path: string, change: ChangeStatus ][] } =
    R.map(() => [], datasets[workDir] || {});

  for (const [bufferPath, changeStatus] of changedBufferPaths) {
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

  /* Constructs a function that takes a buffer path and returns a path to an object
     that is considered as containing that buffer path.
     The returned path is relative to dataset directory
     (given as an argument to function constructor).

     An object is considered to be a set of buffers starting with top-level
     buffer path that matches some ser-des rule.

     TODO:

     Containing object path is inferred from buffer path by finding the topmost
     path component that matches any complex (nested) ser-des rule.

     If there’s none, but buffer path itself matches some ser-des rule,
     then buffer path itself is considered to be object path.

     If buffer path doesn’t satisfy any ser-des rule either,
     then it is considered to not belong to any object. */
  function bufferPathBelongsToObjectInDataset(
    datasetDir: string,
    specs: SerializableObjectSpec[], // TODO: get rid of
  ): (bufferPath: string) => string | null {
    return (bufferPath: string): string | null => {
      if (bufferPath.startsWith(`/${datasetDir}`)) {
        const relativeBufferPath = stripLeadingSlash(path.relative(`/${datasetDir}`, bufferPath));

        //const pathParts = relativeBufferPath.split(path.posix.sep);

        //let idx: number | undefined = undefined;
        //for (const [_idx, part] of pathParts.entries()) {
        //  if (getSerDesRuleForExtension(path.posix.extname(part)) !== undefined) {
        //    idx = _idx;
        //    break;
        //  }
        //}

        //if (idx) {
        //  const relativeObjectPath = `/${pathParts.slice(0, idx).join(path.posix.sep)}`;
        //  return relativeObjectPath;
        //} else {
        //  if (getSerDesRuleForExtension(path.posix.extname(relativeBufferPath)) !== undefined) {
        //    return relativeBufferPath;
        //  }
        //  return null;
        //}

        const spec = getSpec(specs, relativeBufferPath);
        if (spec) {
          let objectPath: string;
          if (spec.getContainingObjectPath) {
            const func = new Function('bufferPath', spec.getContainingObjectPath);
            objectPath = func(bufferPath) || bufferPath;
          } else {
            objectPath = bufferPath;
          }
          return objectPath;
        }
      }
      return null;
    };
  }

  const objectPathChanges: { [datasetDir: string]: PathChanges } = {};

  for (const [changedDatasetDir, changes] of Object.entries(changedBuffersPerDataset)) {
    const specs = getSpecs(workDir, changedDatasetDir);
    const findObjectPath = bufferPathBelongsToObjectInDataset(changedDatasetDir);
    const pathChanges = changedPathsToPathChanges(changes);
    const objectPaths = listObjectPaths(getChangedPaths(changes), findObjectPath);

    objectPathChanges[changedDatasetDir] = pathChanges;

    await updateIndexes(
      workDir,
      changedDatasetDir,
      objectPaths,
      specs,
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
  streamIndexStatus,
  getFilteredObject,
  resolveRepositoryChanges,
};


// Events

async function updateIndexes(
  workDir: string,
  datasetDir: string,
  changedObjectPaths: AsyncGenerator<string>,
  objectSpecs: SerializableObjectSpec[],
  oid1: string,
  oid2: string,
) {
  const ds = getLoadedDataset(workDir, datasetDir);
  const defaultIndex: Datasets.Util.DefaultIndex = getIndex(workDir, datasetDir);
  const affectedFilteredIndexes: Datasets.Util.FilteredIndex[] = [];

  const filteredIndexIDsToCheck: string[] =
    Object.keys(ds.indexes).filter(k => k !== 'default');

  const defaultIdxDB = defaultIndex.dbHandle;

  async function readObjectVersions(objectPath: string):
  Promise<[ Record<string, any> | null, Record<string, any> | null ]> {
    const spec = getSpec(objectSpecs, objectPath);
    if (!spec) {
      throw new Error("Cannot find object spec");
    }
    const rule = getSerDesRule(spec.serDesRule);
    return [
      rule.deserialize(await readBuffersAtVersion(workDir, path.join(datasetDir, objectPath), oid1), {}),
      rule.deserialize(await readBuffersAtVersion(workDir, path.join(datasetDir, objectPath), oid2), {}),
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
      if (idx.predicate(objv1) || idx.predicate(objv2)) {
        affectedFilteredIndexes.push(idx);
        filteredIndexIDsToCheck.splice(filteredIndexIDsToCheck.indexOf(idxID, 1));
      }
    }
  }

  // Rebuild affected filtered indexes
  for (const filteredIndex of affectedFilteredIndexes) {
    await filteredIndex.dbHandle.clear();
    await fillInFilteredIndex(defaultIndex, filteredIndex);
  }
}


async function updateDefaultIndex(
  workDir: string,
  datasetDir: string,
  index: Datasets.Util.DefaultIndex,
  objectPaths: AsyncGenerator<string>,
  objectSpecs: SerializableObjectSpec[],
) {
  for await (const objectPath of objectPaths) {
    const spec = getSpec(objectSpecs, objectPath);
    if (!spec) {
      throw new Error("Unexpectedly missing object spec while updating default index");
    }

    console.debug("Worker: Datasets: Filling in default index: Reading", objectPath);

    const obj = await readObjectCold(path.join(workDir, datasetDir, objectPath), spec);

    console.debug("Worker: Datasets: Filling in default index: Reading", objectPath, obj);

    if (obj !== null) {
      await index.dbHandle.put(objectPath, obj);
    } else {
      try {
        await index.dbHandle.del(objectPath);
      } catch (e) {
        if (e.type !== 'NotFoundError') {
          throw e;
        }
      }
    }
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
  objectSpecs: SerializableObjectSpec[],
) {
  let total: number = 0;

  function belongsToObject(bufferPath: string): string | null {
    const spec = getSpec(objectSpecs, bufferPath);
    if (spec) {
      if (spec.getContainingObjectPath) {
        const func = new Function('bufferPath', spec.getContainingObjectPath);
        return func(bufferPath);
      } else {
        return bufferPath;
      }
    } else {
      return null;
    }
  }

  // Collect object paths
  const objectPaths = listObjectPaths(
    listDescendantPaths(path.join(workDir, datasetDir)),
    belongsToObject);
  for await (const objectPath of objectPaths) {
    index.statusSubject.next({
      objectCount: 0,
      progress: {
        phase: 'counting',
        total,
        loaded: 0,
      },
    });
    try {
      await index.dbHandle.get(objectPath);
    } catch (e) {
      if (e.type === 'NotFoundError') {
        await index.dbHandle.put(objectPath, false);
        total += 1;
      }
    }
  }

  async function* changedObjectPaths(): AsyncGenerator<string> {
    for await (const _key of index.dbHandle.createKeyStream()) {
      yield _key as string;
    }
  }

  console.debug("Worker: Datasets: Filling in default index", workDir, datasetDir);

  await updateDefaultIndex(
    workDir,
    datasetDir,
    index,
    changedObjectPaths(),
    objectSpecs);
}

async function fillInFilteredIndex(
  defaultIndex: Datasets.Util.DefaultIndex,
  filteredIndex: Datasets.Util.FilteredIndex,
) {
  const defaultIndexDB = defaultIndex.dbHandle;
  const filteredIndexDB = filteredIndex.dbHandle;
  const predicate = filteredIndex.predicate;

  const total = defaultIndex.status.objectCount;

  let indexed: number = 0;
  let loaded: number = 0;
  for await (const data of defaultIndexDB.createReadStream()) {
    // TODO: [upstream] NodeJS.ReadableStream is poorly typed.
    const { key, value } = data as unknown as { key: string, value: Record<string, any> };
    const objectPath: string = key;
    const objectData: Record<string, any> = value;

    if (predicate(objectData) === true) {
      filteredIndexDB.put(indexed, objectPath);
      indexed += 1;
    }
    loaded += 1;

    filteredIndex.statusSubject.next({
      objectCount: indexed,
      progress: {
        phase: 'indexing',
        total,
        loaded,
      },
    })
  }
}

function createIndex<K, V>(
  workDir: string,
  datasetDir: string,
  indexID: string,
  codecOptions: CodecOptions,
): Datasets.Util.ActiveDatasetIndex<K, V> {
  const ds = getLoadedDataset(workDir, datasetDir); 
  const cacheRoot = ds.indexDBRoot;

  const dbPath = path.join(cacheRoot, indexID);
  const idx: Datasets.Util.ActiveDatasetIndex<K, V> = {
    status: { objectCount: 0 },
    statusSubject: new Subject<IndexStatus>(), 
    dbHandle: levelup(encode(leveldown(dbPath), codecOptions)),
  };

  datasets[workDir][datasetDir].indexes[indexID] = idx;
  return idx;
}


// Specs

export function getSpecs(
  workDir: string,
  datasetDir: string,
): SerializableObjectSpec[] {
  const ds = getLoadedDataset(workDir, datasetDir);
  if (!ds.specs) {
    throw new Error("Loaded dataset does not have specs registered");
  }
  return ds.specs;
}

export function getSpec(
  objectSpecs: SerializableObjectSpec[],
  objectOrBufferPath: string,
): SerializableObjectSpec | null {
  const spec = Object.values(objectSpecs).
    find(c => matchesPath(objectOrBufferPath, c.matches));
  return spec ?? null;
}
