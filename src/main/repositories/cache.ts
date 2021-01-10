import log from 'electron-log';
import { app } from 'electron';

import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import levelup, { LevelUp } from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import { ObjectChangeset, ObjectData, ObjectDataRequest, ObjectDataset } from '@riboseinc/paneron-extension-kit/types';
import { PANERON_REPOSITORY_META_FILENAME } from 'repositories';
import { stripLeadingSlash } from './worker/git-methods';
import getDecoder from './worker/decoders';
import worker from './workerInterface';


const UTF_DECODER = getDecoder('utf-8');
const UTF_ENCODER = new TextEncoder();


const cacheDBs: { [workingCopyPath: string]: Promise<LevelUp> } = {};


function hash(val: string): string {
  return crypto.createHash('sha1').update(val).digest('hex');
}


function getDBPath(workingCopyPath: string): string {
  const dbDirName = hash(workingCopyPath);
  return path.join(app.getPath('userData'), dbDirName);
}


async function getDB(workingCopyPath: string): Promise<LevelUp> {
  if (!cacheDBs[workingCopyPath]) {
    cacheDBs[workingCopyPath] = new Promise(async (resolve, reject) => {
      const db = levelup(encode(leveldown(getDBPath(workingCopyPath)), {
        keyEncoding: 'string',
        valueEncoding: 'binary', // Encoding will be specified per key.
      }));
      log.debug("Repositories: Cache: Created DB", workingCopyPath);
      try {
        const w = await worker;

        const meta = (await w.getObjectContents({
          workDir: workingCopyPath,
          readObjectContents: { [PANERON_REPOSITORY_META_FILENAME]: 'utf-8' },
        }))[PANERON_REPOSITORY_META_FILENAME];

        if (!meta) {
          log.debug("Repositories: Cache: Not a Paneron repo, will not populate DB", workingCopyPath);
          resolve(db);
          return;
        }

        log.debug("Repositories: Cache: Populating DB…", workingCopyPath);
        const paths = await w.listAllObjectPaths({ workDir: workingCopyPath });
        await _populate(workingCopyPath, db, paths);
        log.debug("Repositories: Cache: Populating DB… Done", workingCopyPath);
        resolve(db);
      } catch (e) {
        log.error("Repositories: Cache: Error populating DB", workingCopyPath, e);
        resolve(db);
      }
    });
  }
  return cacheDBs[workingCopyPath];
}


app.on('quit', async () => {
  const destroyPromises: Promise<void>[] =
    Object.keys(cacheDBs).map(p => destroy({ workingCopyPath: p }));
  await Promise.all(destroyPromises);
});


async function _populate(workingCopyPath: string, db: LevelUp, paths: string[]) {
  for (const _fp of paths) {
    const fp = stripLeadingSlash(_fp);
    const filedata = fs.readFileSync(path.join(workingCopyPath, fp));
    await db.put(fp, filedata);
  }
}


// API

async function populate
(opts: { workingCopyPath: string, paths: string[] }):
Promise<void> {
  const { workingCopyPath, paths } = opts;
  const db = await getDB(workingCopyPath);
  return await _populate(workingCopyPath, db, paths)
}


async function destroy(opts: { workingCopyPath: string }) {
  try {
    if (cacheDBs[opts.workingCopyPath]) {
      const db = await cacheDBs[opts.workingCopyPath];
      await db.close();
      delete cacheDBs[opts.workingCopyPath];
    }
  } catch(e) {
    log.error("Repositories: Cache: Error destroying DB", opts.workingCopyPath, e);
  } finally {
    fs.removeSync(getDBPath(opts.workingCopyPath));
  }
}


// async function listPathsWithSyncStatus
// (opts: { workingCopyPath: string }):
// Promise<Record<string, FileChangeType> | null> {
//   const { workingCopyPath } = opts;
//   //const queryKey = hash(JSON.stringify(query));
// 
//   const db = getDB(workingCopyPath);
//   try {
//     return await db.get(SYNC_STATUS_KEY, { valueEncoding: 'json' });
//   } catch (e) {
//     if (e.type === 'NotFoundError') {
//       return null;
//     } else {
//       throw e;
//     }
//   }
// }


async function listPaths
(opts: { workingCopyPath: string, query?: { pathPrefix: string, contentSubstring?: string } }):
Promise<string[]> {
  const { workingCopyPath, query } = opts;
  //const queryKey = hash(JSON.stringify(query));

  const db = await getDB(workingCopyPath);
  const pathPrefix = query?.pathPrefix
    ? stripLeadingSlash(query.pathPrefix)
    : null;

  return new Promise((resolve, reject) => {
    const keyStream = db.createKeyStream();
    const paths: string[] = [];
    keyStream.on('data', (p) => {
      if (!pathPrefix || p === path.join(pathPrefix, path.basename(p))) {
        paths.push(p);
      }
    })
    keyStream.on('error', reject);
    keyStream.on('close', () => {
      reject("Stream closed");
    })
    keyStream.on('end', () => {
      resolve(paths);
    })
  });
}


async function invalidatePaths
(opts: { workingCopyPath: string, paths?: string[] }):
Promise<void> {
  const { workingCopyPath, paths } = opts;
  const db = await getDB(workingCopyPath);
  if (paths === undefined) {
    await destroy({ workingCopyPath });
  } else if (paths.length > 0) {
    await db.batch(paths.map(p => ({ type: 'del', key: p })));
  }
}


async function getObjectContents
(opts: { workingCopyPath: string, objects: ObjectDataRequest }):
Promise<ObjectDataset> {
  const { workingCopyPath, objects } = opts;
  const db = await getDB(workingCopyPath);

  try {
    return (await Promise.all(Object.entries(objects).map(async ([path, encoding]) => {
      //const valueEncoding: LevelEncoding = encoding === 'utf-8' ? 'utf8' : encoding;
      const outputEncoding = encoding === 'binary' ? undefined : encoding;
      let blob: Buffer | null;
      try {
        blob = await db.get(path);
      } catch (e) {
        if (e.type === 'NotFoundError') {
          blob = null;
        } else {
          throw e;
        }
      }
      let result: ObjectData;
      if (blob === null) {
        result = blob;
      } else if (outputEncoding === 'utf-8') {
        result = {
          encoding: outputEncoding,
          value: UTF_DECODER.decode(blob),
        };
      } else if (!outputEncoding) {
        result = {
          encoding: outputEncoding,
          value: blob,
        };
      } else {
        throw new Error("Repositories: Cache: Unsupported encoding");
      }
      return { [path]: result };
    }))).
    reduce((prev, curr) => ({ ...prev, ...curr }), {});
  } catch (e) {
    log.error("Repositories: Cache: Failed to read object contents", e);
    throw e;
  }
}


async function applyChangeset
(opts: { workingCopyPath: string, changeset: ObjectChangeset }):
Promise<void> {
  const { workingCopyPath, changeset } = opts;
  const db = await getDB(workingCopyPath);
  const deletedPaths: string[] = [];

    // TODO: Batch changes!
  await Promise.all(Object.entries(changeset).map(async ([path, change]) => {
    if (change.newValue === null) {
      await db.del(path);
      deletedPaths.push(path);
      return;
    }
    if (change.encoding === undefined) {
      await db.put(path, change.newValue);
    } else if (change.encoding === 'utf-8') {
      await db.put(path, UTF_ENCODER.encode(change.newValue));
    } else {
      throw new Error("Repositories: Cache: Unsupported encoding when writing data");
    }
  }));

  await invalidatePaths({ workingCopyPath, paths: deletedPaths });
}


export default {
  populate,
  listPaths,
  //listPathsWithSyncStatus,
  getObjectContents,
  applyChangeset,
  invalidatePaths,
  destroy,
};
