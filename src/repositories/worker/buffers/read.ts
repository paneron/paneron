import path from 'path';
import fs from 'fs';
import git from 'isomorphic-git';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { stripLeadingSlash, stripTrailingSlash } from '../../../utils';
import { listDescendantPaths, listDescendantPathsAtVersion } from './list';
import { Repositories } from '../types';


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


/* Given a root path, returns a BufferDataset containing data under that path.
   Paths in buffer dataset will be slash-prepended and relative to root path. */
export async function readBuffers(
  rootPath: string,
): Promise<Record<string, Uint8Array>> {
  const buffers: Record<string, Uint8Array> = {};
  for await (const relativeBufferPath of listDescendantPaths(rootPath)) {
    const bufferData = readBuffer(path.join(rootPath, stripLeadingSlash(relativeBufferPath)));
    if (bufferData) {
      buffers[relativeBufferPath] = bufferData;
    }
  }
  return buffers;
}


/* Given a root path, returns a BufferDataset containing data under that path.
   Paths in buffer dataset will be slash-prepended and relative to root path. */
export async function readBuffersAtVersion(
  workDir: string,
  rootPath: string,
  atCommitHash: string,
): Promise<Record<string, Uint8Array>> {
  const buffers: Record<string, Uint8Array> = {};
  const bufferPathsRelativeToRoot = await listDescendantPathsAtVersion(
    rootPath,
    workDir,
    atCommitHash);
  for (const [relativeBufferPath, _] of bufferPathsRelativeToRoot) {
    const bufferPath = path.join(rootPath, relativeBufferPath);
    const bufferData: Uint8Array | null = await readBufferAtVersion(
      bufferPath,
      atCommitHash,
      workDir);
    if (bufferData) {
      buffers[relativeBufferPath] = bufferData;
    }
  }
  return buffers;
}


/* Reads buffer data for specified paths, optionally at specified Git commit. */
export async function readBuffers2(
  workDir: string,
  bufferPaths: string[],
  atCommitHash?: string,
): Promise<BufferDataset> {
  const normalizedPaths = bufferPaths.map(stripLeadingSlash);

  let reader: (path: string) => Promise<null | Uint8Array> | null | Uint8Array;
  if (atCommitHash === undefined) {
    reader = (p) => readBuffer(path.join(workDir, p));
  } else {
    reader = (p) => readBufferAtVersion(p, atCommitHash, workDir);
  }

  return (await Promise.all(normalizedPaths.map(async ([path]) => {
    return {
      [path]: await reader(path),
    };
  }))).reduce((prev, curr) => ({ ...prev, ...curr }), {});
}


/* Returns blob at given path, or null if it doesn’t exist.
   Blob may have uncommitted changes.

   Buffer is considered nonexistent if ENOENT is received,
   other errors are thrown. */
export function readBuffer(fullPath: string): Uint8Array | null {
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


/* Retrieves state of blob at given path as of given commit hash using Git.

   Buffer is considered nonexistent if Isomorphic Git returns NotFoundError,
   other errors are thrown.

   NOTE: This function is somewhat slow. */
export async function readBufferAtVersion(
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
