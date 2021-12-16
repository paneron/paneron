import path from 'path';
import fs from 'fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { pointsToLFS } from '@riboseinc/isogit-lfs/util';
import { downloadBlobFromPointer, readPointer } from '@riboseinc/isogit-lfs';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';

import { stripLeadingSlash, stripTrailingSlash } from '../../../utils';
import { normalizeURL } from '../../util';
import { Repositories } from '../types';
import { listDescendantPaths, listDescendantPathsAtVersion } from './list';


/**
 * Given a work dir and a rootPath relative to it,
 * returns a BufferDataset with buffers under the root path.
 *
 * Paths in buffer dataset will be slash-prepended and relative to root path.
 *
 * If there’s no descendants (e.g., rootPath is a file),
 * buffer dataset will contain a sole key '/' mapping to the buffer.
 *
 * Object paths referencing nonexistent objects
 * will not have null values, but will be silently omitted.
 * (Returned dataset can be a completely empty object.)
 *
 * If any of the objects read are LFS pointers,
 * this function will attempt to retrieve LFS data if `resolveLFS` is provided,
 * returning unresolved pointer if download fails.
 */
export const readBuffers: Repositories.Data.ReadBuffers = async function ({
  workDir,
  rootPath,
  resolveLFS,
}): Promise<Record<string, Uint8Array>> {
  const buffers: Record<string, Uint8Array> = {};
  const absoluteRootPath = path.join(workDir, rootPath);

  for await (const relativeBufferPath of listDescendantPaths(absoluteRootPath)) {
    const bPath = path.join(absoluteRootPath, stripLeadingSlash(relativeBufferPath));
    const bufferData = readBuffer(bPath);

    if (bufferData !== null) {
      // TODO: Refactor LFS fetch: implement batch in `resolveLFSPointersInBufferDataset()`
      // and reuse it in `readBuffersAtVersion()`? Depends on batch support in isogit-lfs.
      if (resolveLFS !== undefined && pointsToLFS(Buffer.from(bufferData))) {
        const lfsPointer = readPointer({
          dir: workDir,
          content: Buffer.from(bufferData),
        });
        try {
          buffers[relativeBufferPath] = await downloadBlobFromPointer({
            url: normalizeURL(resolveLFS.url),
            auth: resolveLFS.auth,
            http,
          }, lfsPointer);
        } catch (e) {
          buffers[relativeBufferPath] = bufferData;
        }

      } else {
        buffers[relativeBufferPath] = bufferData;
      }
    }
  }
  return buffers;
}


/**
 * Given a root path, returns a BufferDataset containing data under that path.
 * Paths in buffer dataset will be slash-prepended and relative to root path.
 *
 * NOTE: Does not support LFS yet.
 */
export const readBuffersAtVersion: Repositories.Data.ReadBuffersAtVersion = async function ({
  workDir,
  rootPath,
  commitHash,
}): Promise<Record<string, Uint8Array>> {
  // TODO: Support LFS in `readBuffersAtVersion()`?

  const buffers: Record<string, Uint8Array> = {};
  const bufferPathsRelativeToRoot = await listDescendantPathsAtVersion(
    rootPath,
    workDir,
    commitHash);
  for (const [relativeBufferPath, _] of bufferPathsRelativeToRoot) {
    const bufferPath = path.join(rootPath, relativeBufferPath);
    const bufferData: Uint8Array | null = await readBufferAtVersion(
      bufferPath,
      commitHash,
      workDir);
    if (bufferData) {
      buffers[relativeBufferPath] = bufferData;
    }
  }
  return buffers;
}


// Older implementation combined readBuffers & readBuffersAtVersion:
// /** Reads buffer data for specified paths, optionally at specified Git commit. */
// export async function readBuffers2(
//   workDir: string,
//   bufferPaths: string[],
//   atCommitHash?: string,
// ): Promise<BufferDataset> {
//   const normalizedPaths = bufferPaths.map(stripLeadingSlash);
// 
//   let reader: (path: string) => Promise<null | Uint8Array> | null | Uint8Array;
//   if (atCommitHash === undefined) {
//     reader = (p) => readBuffer(path.join(workDir, p));
//   } else {
//     reader = (p) => readBufferAtVersion(p, atCommitHash, workDir);
//   }
// 
//   return (await Promise.all(normalizedPaths.map(async ([path]) => {
//     return {
//       [path]: await reader(path),
//     };
//   }))).reduce((prev, curr) => ({ ...prev, ...curr }), {});
// }


/**
 * Given a list of buffer paths, returns a BufferDataset.
 * readBuffers() should be preferred instead.
 */
export const getBufferDataset: Repositories.Data.GetBufferDataset = async function ({
  workDir,
  paths,
}) {
  //console.debug("Reading buffers at paths", workDir, paths);
  const bufferDataset: BufferDataset = paths.map((bufferPath) => {
    return {
      [bufferPath]: readBuffer(path.join(workDir, bufferPath)),
    };
  }).reduce((prev, curr) => ({ ...prev, ...curr }), {});

  return bufferDataset;
}


/**
 * NOTE: This isn’t a Git-specific function,
 * it works with filesystem directly.
 * 
 * Returns blob at given path, or null if it doesn’t exist.
 * Blob may have uncommitted changes.
 * 
 * Buffer is considered nonexistent if ENOENT is received,
 * other errors are thrown.
 */
function readBuffer(fullPath: string): Uint8Array | null {
  try {
    return fs.readFileSync(fullPath);
  } catch (e) {
    if ((e as any).code === 'ENOENT') {
      return null;
    } else {
      throw e;
    }
  }
}


/**
 * Retrieves state of blob at given path as of given commit hash using Git.
 * 
 * Buffer is considered nonexistent if Isomorphic Git returns NotFoundError,
 * other errors are thrown.
 * 
 * NOTE: This function is somewhat slow.
 */
async function readBufferAtVersion(
  path: string,
  commitHash: string,
  workDir: string,
): Promise<Uint8Array | null> {
  let blob: Uint8Array;
  const filepath = stripTrailingSlash(stripLeadingSlash(path));
  try {
    blob = (await git.readBlob({
      fs,
      dir: workDir,
      oid: commitHash,
      filepath,
    })).blob;
  } catch (e) {
    if ((e as any).code === 'NotFoundError') {
      return null;
    } else {
      throw e;
    }
  }
  return blob;
}
