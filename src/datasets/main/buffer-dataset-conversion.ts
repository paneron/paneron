import path from 'path';
import type { ObjectChangeset } from '@riboseinc/paneron-extension-kit/types/objects';
import type { BufferChange, BufferChangeset, BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { findSerDesRuleForObject } from '@riboseinc/paneron-extension-kit/object-specs/ser-des';
import { stripTrailingSlash } from 'utils';


/**
 * Converts object changeset
 * (a record that maps paths to object changes)
 * to buffer changeset
 * (a record that maps paths to buffer changes)
 * ready for commit.
 *
 * All paths should be POSIX-style, dataset-relative.
 *
 * Repository working diretory should be absolute.
 * Dataset root should be relative to working directory,
 * and must not contain leading slash.
 *
 * Accepted object paths are relative to given dataset root,
 * returned buffer paths are relative to working directory.
 */
export function toBufferChangeset(
  /** Object changeset with dataset-relative POSIX-style paths. */
  objectChangeset: ObjectChangeset,
  /** Repo-relative dataset path. */
  datasetDir: string,
): BufferChangeset {
  const buffers: BufferChangeset = {};

  for (const [objectPath, change] of Object.entries(objectChangeset)) {
    let oldObjectBuffersRelative: BufferDataset;
    let newObjectBuffersRelative: BufferDataset;

    if (change.newValue !== null) {
      const rule = findSerDesRuleForObject(objectPath, change.newValue);
      newObjectBuffersRelative = rule.serialize(change.newValue, {});
    } else {
      newObjectBuffersRelative = { [path.posix.sep]: null };
    }

    // When conflict check is disabled
    // (_dangerouslySkipValidation in updateObjects),
    // `oldValue`s will be undefined.
    // However, we can actually ignore them, because the only caller
    // (updateObjects) does not actually use them.
    if (change.oldValue !== undefined) {
      if (change.oldValue !== null) {
        const rule = findSerDesRuleForObject(objectPath, change.oldValue);
        oldObjectBuffersRelative = rule.serialize(change.oldValue, {});
      } else {
        oldObjectBuffersRelative = { [path.posix.sep]: null };
      }
    } else {
      oldObjectBuffersRelative = {};
    }

    const bufferChanges = mergeBufferDatasetsIntoChangeset(
      oldObjectBuffersRelative,
      newObjectBuffersRelative,
      datasetDir,
      objectPath);

    Object.assign(buffers, bufferChanges);
  }
  return buffers;
}


function mergeBufferDatasetsIntoChangeset(
  oldDataset: BufferDataset,
  newDataset: BufferDataset,
  /** Repository-relative path to dataset. */
  datasetPath: string,
  objectPath: string,
): BufferChangeset {
  const paths = Array.from(new Set([
    ...Object.keys(oldDataset),
    ...Object.keys(newDataset),
  ]));

  const changeset: BufferChangeset = {};

  for (const p of paths) {
    const change: BufferChange = {
      // Something may be fishy about null values here.
      // Generally, null values mean absence of an object,
      // while undefined means ommitted value (e.g., to disable oldValue comparison).
      // Perhaps undefined oldValue may not be possible at this stage?
      // If so, need to document
      oldValue: oldDataset[p] ?? undefined,
      newValue: newDataset[p] ?? null,
    };
    changeset[stripTrailingSlash(path.join(datasetPath, objectPath, p))] = change;
  }

  return changeset;
}


/* Converts a record that maps paths to object data
   to a record that maps paths to buffers / byte arrays.

   Repository working diretory should be absolute.
   Dataset root should be relative to working directory,
   and must not contain leading slash.

   Accepted object paths are relative to given dataset root,
   returned buffer paths are relative to working directory.
*/
// export function toBufferDataset(
//   workDir: string,
//   datasetDirNormalized: string,
//   objectDataset: ObjectDataset,
// ): BufferDataset {
//   const objectSpecs = getSpecs(workDir, datasetDirNormalized);
// 
//   const buffers: Record<string, Uint8Array> = {};
// 
//   for (const [objectPath, obj] of Object.entries(objectDataset)) {
//     const spec = getSpec(objectSpecs, objectPath);
// 
//     if (spec) {
//       const objectBuffersRelative = spec.serialize(obj);
// 
//       const objectBuffers: Record<string, Uint8Array> = Object.entries(objectBuffersRelative).
//         map(([objectRelativePath, data]) => ({
//           [`/${path.join(datasetDirNormalized, objectPath, objectRelativePath)}`]: data,
//         })).
//         reduce((p, c) => ({ ...p, ...c }), {});
// 
//       Object.assign(buffers, objectBuffers);
// 
//     } else {
//       //log.error("Unable to find object spec for object path", objectPath);
//       throw new Error("Unable to find object spec for path");
//     }
//   }
//   return buffers;
// }


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
