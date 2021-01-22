import path from 'path';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import lexint from 'lexicographic-integer';
import { CodecOptions } from 'level-codec';
import { Observable, Subject } from 'threads/observable';

import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { SerializableObjectSpec } from '@riboseinc/paneron-extension-kit/types/object-spec';
import { matchesPath } from '@riboseinc/paneron-extension-kit/object-specs';

import { IndexStatus } from 'repositories/types';
import { stripLeadingSlash, stripTrailingSlash } from 'utils';
import { Datasets } from './types';
import { listDescendantPaths } from './buffers/list';
import { listObjectPaths } from './objects/list';
import { readObjectCold } from './objects/read';


// We’ll just keep track of loaded datasets right here in memory

// { datasetID: { objectPath: { field1: value1, ... }}}
const datasets: {
  [workDir: string]: {
    [datasetDir: string]: Datasets.Util.LoadedDataset
  }
} = {};


// Main API

const unload: Datasets.Lifecycle.Unload = async function ({
  workDir,
  datasetDir,
}) {
  const ds = datasets[workDir]?.[datasetDir];
  if (ds) {
    for (const { dbHandle, statusSubject } of Object.values(ds.indexes)) {
      await dbHandle.close();
      statusSubject.complete();
    }
  }
}

const load: Datasets.Lifecycle.Load = async function ({
  workDir,
  datasetDir,
  objectSpecs,
  cacheRoot,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  await unload({ workDir, datasetDir });

  const defaultIndex: Datasets.Util.DefaultIndex = createIndex(
    workDir,
    normalizedDatasetDir,
    'default',
    {
      keyEncoding: 'string',
      valueEncoding: 'json',
    },
  );

  datasets[workDir] ||= {};
  datasets[workDir][datasetDir] = {
    specs: objectSpecs,
    indexDBRoot: cacheRoot,
    indexes: {
      default: defaultIndex,
    },
  };

  fillInDefaultIndex(workDir, datasetDir, defaultIndex, objectSpecs);
}

const getOrCreateFilteredIndex: Datasets.Indexes.GetOrCreateFiltered = function ({
  workDir,
  datasetDir,
  queryExpression,
}) {
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);

  const defaultIndex: Datasets.Util.DefaultIndex =
    getIndex(workDir, normalizedDatasetDir);

  const filteredIndexID = queryExpression; // XXX

  let filteredIndex: Datasets.Util.FilteredIndex;
  try {

    filteredIndex = getIndex(
      workDir,
      normalizedDatasetDir,
      filteredIndexID,
    );

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
    );

    let predicate: Datasets.Util.FilteredIndexPredicate;
    try {
      predicate = new Function('obj', queryExpression) as Datasets.Util.FilteredIndexPredicate;
    } catch (e) {
      throw new Error("Unable to parse submitted predicate expression");
    }

    // TODO: Report index status as it happens
    fillInFilteredIndex(defaultIndex, filteredIndex, predicate);

  }

  return { indexID: filteredIndexID };
}

const describeIndex: Datasets.Indexes.Describe = function ({ workDir, datasetDir, indexID }) {
  const idxID = indexID || 'default';
  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  const idx = getIndex(workDir, normalizedDatasetDir, idxID);
  return {
    status: idx.status,
    stream: Observable.from(idx.statusSubject),
  };
}

const getIndexedObject: Datasets.Indexes.GetObject = async function ({ workDir, datasetDir, indexID, position }) {
  if (indexID === 'default') {
    throw new Error("Default index is not supported by getIndexedObject");
  }

  const normalizedDatasetDir = normalizeDatasetDir(datasetDir);
  const idx: Datasets.Util.FilteredIndex =
    getIndex(workDir, normalizedDatasetDir, indexID);
  const db = idx.dbHandle;
  const objectPath = await db.get(position);

  return { objectPath };
}


export default {
  load,
  unload,
  getOrCreateFilteredIndex,
  describeIndex,
  getIndexedObject,
};


// Utility functions

// Below, datasetDir is expected to be normalized (no leading slash).

export function normalizeDatasetDir(datasetDir: string) {
  return stripTrailingSlash(stripLeadingSlash(datasetDir));
}

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
        return spec.getContainingObjectPath(bufferPath);
      } else {
        return bufferPath;
      }
    } else {
      return null;
    }
  }

  const rootDir = path.join(workDir, datasetDir);
  const objectPaths = listObjectPaths(listDescendantPaths(rootDir), belongsToObject);
  for await (const objectPath of objectPaths) {
    index.statusSubject.next({
      objectCount: 0,
      progress: {
        phase: 'counting',
        total,
        loaded: 0,
      }
    });
    await index.dbHandle.put(objectPath, undefined);
    total += 1;
  }

  for await (const _key of index.dbHandle.createKeyStream()) {
    const objectPath = _key as string;
    const spec = getSpec(objectSpecs, objectPath);
    if (!spec) {
      throw new Error("Unexpectedly missing object spec while creating default dataset index");
    }
    const obj = await readObjectCold(path.join(workDir, datasetDir, objectPath), spec);
    if (obj !== null) {
      await index.dbHandle.put(objectPath, obj);
    }
  }
}

async function fillInFilteredIndex(
  defaultIndex: Datasets.Util.DefaultIndex,
  filteredIndex: Datasets.Util.FilteredIndex,
  predicate: Datasets.Util.FilteredIndexPredicate,
) {
  const defaultIndexDB = defaultIndex.dbHandle;
  const filteredIndexDB = filteredIndex.dbHandle;

  const total = defaultIndex.status.objectCount;

  let indexed: number = 0;
  let loaded: number = 0;
  for await (const data of defaultIndexDB.createReadStream()) {
    // TODO: Upstream: NodeJS.ReadableStream is poorly typed.
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

function getLoadedDataset(
  workDir: string,
  datasetDir: string,
): Datasets.Util.LoadedDataset {
  const ds = datasets[workDir]?.[datasetDir];
  if (!ds) {
    throw new Error("Dataset does not exist or is not loaded");
  }
  return ds;
}

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
  return spec || null;
}


/* Converts a record that maps paths to object data
   to a record that maps paths to buffers / byte arrays
   ready for storage.

   Repository working diretory should be absolute.
   Dataset root should be relative to working directory,
   and must not contain leading slash.

   Accepted object paths are relative to given dataset root,
   returned buffer paths are relative to working directory.
*/
export function toBufferDataset(
  workDir: string,
  datasetDirNormalized: string,
  objectDataset: ObjectDataset,
) {
  const objectSpecs = getSpecs(workDir, datasetDirNormalized);

  const buffers: Record<string, Uint8Array> = {};

  for (const [objectPath, obj] of Object.entries(objectDataset)) {
    const spec = getSpec(objectSpecs, objectPath);

    if (spec) {
      const objectBuffersRelative = (spec as SerializableObjectSpec).serialize(obj);

      const objectBuffers: Record<string, Uint8Array> =
        Object.entries(objectBuffersRelative).
        map(([objectRelativePath, data]) => ({
          [`/${path.join(datasetDirNormalized, objectPath, objectRelativePath)}`]: data,
        })).
        reduce((p, c) => ({ ...p, ...c }), {});

      Object.assign(buffers, objectBuffers);

    } else {
      //log.error("Unable to find object spec for object path", objectPath);
      throw new Error("Unable to find object spec for path");
    }
  }
  return buffers;
}


/* Converts buffers with raw file data per path
   to structured records (as JS objects) per path.
   Specs for conversion can be provided to makeExtension to customize
   how object is represented.
   NOTE: Slow, when processing full repository data
   it is supposed to be called from a worker thread only. */
// function toObjectDataset(
//   workDir: string,
//   datasetDir: string,
//   bufferDataset: Record<string, Uint8Array>,
// ): ObjectDataset {
//   const ds = datasets[workDir]?.[datasetDir];
//   if (!ds || !ds.specs) {
//     throw new Error("Dataset does not exist or specs not registered");
//   }
//   const objectSpecs = ds.specs;
// 
//   // 1. Go through paths and organize them by matching object spec.
//   // If a path matches some spec, that path is considered new object root,
//   // and subsequent paths are considered to belong to this object
//   // if they are descendants of object root path.
//   const toProcess: {
//     objectPath: string
//     data: Record<string, Uint8Array>
//     spec: SerializableObjectSpec
//   }[] = [];
// 
//   // Sorted paths will appear in fashion [/, /foo/, /foo/bar.yaml, /baz/, /baz/qux.yaml, ...]
//   const paths = Object.keys(bufferDataset).sort();
// 
//   let currentSpec: SerializableObjectSpec | undefined;
//   let currentObject: {
//     path: string
//     buffers: Record<string, Uint8Array>
//   } | null = null;
// 
//   for (const p of paths) {
// 
//     if (currentObject && p.startsWith(currentObject.path)) {
//       // We are in the middle of processing an object
//       // and current path is a descendant of object’s path.
// 
//       // Accumulate current path into current object for deserialization later.
//       const objectRelativePath = stripLeadingSlash(p.replace(currentObject.path, ''));
//       currentObject.buffers[`/${objectRelativePath}`] = bufferDataset[p];
// 
//       //log.debug("Matched path to object", p, currentObject.path, objectRelativePath);
// 
//     } else {
//       // Were we in the middle of processing a spec and an object?
//       if (currentSpec && currentObject) {
//         // If yes, add that spec and accumulated object to list for further processing...
//         toProcess.push({
//           objectPath: currentObject.path,
//           data: { ...currentObject.buffers },
//           spec: currentSpec,
//         });
//         // ...and reset/flush accumulated object.
//         currentObject = null;
//       }
// 
//       // Find a matching spec for current path.
//       currentSpec = Object.values(objectSpecs).find(c => matchesPath(p, c.matches));
// 
//       if (currentSpec) {
//         // If a matching spec was found, start a new object.
//         currentObject = { path: p, buffers: {} };
//         // Current path will be the root path for the object.
//         currentObject.buffers['/'] = bufferDataset[p];
//       }
//     }
//   }
// 
//   // 2. Deserialize accumulated buffers into objects.
//   const index: Record<string, Record<string, any>> = {};
//   for (const { objectPath, data, spec } of toProcess) {
//     index[objectPath] = spec.deserialize(data);
//   }
// 
//   return index;
// }
// 
