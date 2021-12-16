import { spawn, Worker, Thread } from 'threads';
import { app } from 'electron';
import log from 'electron-log';
import type WorkerMethods from '../worker/types';
import type { WorkerSpec } from '../worker/index';


// TODO: This layer may not be that necessary, considering loadedRepositories
// already caches workers—but we want it for “abstract” worker not attached
// to a working directory.
const WORKERS: { [workDir: string]: Promise<RepoWorkers> } = {};


/**
 * IMPORTANT: Currently, two instances of the same worker are created,
 * and care should be taken to use each the right way.
 * 
 * Reader worker is used in stateless lock-free mode, e.g. when raw buffers need to be read.
 * Only that subset of methods should be used.
 * 
 * Sync worker is used to load datasets and access logical objects,
 * and perform sync (push and pull). This is the one used in endpoints exposed to extensions.
 * 
 * This separation is so that data can be read even if expensive sync operation is ongoing
 * (such as pulling a large repository, or dataset object indexing).
 * 
 * This is not a pretty solution.
 */
export interface RepoWorkers {
  reader: Thread & WorkerMethods
  sync: Thread & WorkerMethods
}


export async function terminateRepoWorkers(workDir: string) {
  const repoPromise = WORKERS[workDir];
  log.debug("Repositories: Terminating workers for repo", workDir);

  if (repoPromise) {
    delete WORKERS[workDir];

    const repo = await repoPromise;

    await terminateWorker(repo.sync);
    await terminateWorker(repo.reader);

    log.debug("Repositories: Terminating workers for repo: Done", workDir);
  } else {
    log.debug("Repositories: Terminating workers for repo: Nothing to be done", workDir);
  }
}

async function terminateAllWorkers() {
  log.debug("Repositories: Terminating all repo workers");

  for (const workDir of Object.keys(WORKERS)) {
    await terminateRepoWorkers(workDir);
  }

  log.debug("Repositories: Terminating all repo workers: Done");
}

export function getRepoWorkers(workDir: string): Promise<RepoWorkers> {
  if (!WORKERS[workDir]) {
    log.debug("Repositories: Workers not spawned yet, spawning now…")
    WORKERS[workDir] = new Promise((resolve, reject) => {
      terminateAllWorkers().
      then(() => {
        Promise.all([
          spawnWorker(),
          spawnWorker(),
        ]).then(([ sync, reader ]) => {
          Promise.all([
            sync.openLocalRepo(workDir, 'rw'),
            reader.openLocalRepo(workDir, 'r'),
          ]).then(() => {
            resolve({ sync, reader })
          }).catch(reject);
        }).catch(reject);
      });
    });
  } else {
    log.debug("Repositories: Workers already spawned")
  }

  return WORKERS[workDir];
}


app.on('quit', terminateAllWorkers);


/**
 * Spawns a repository worker.
 * IMPORTANT: It’s caller’s responsibility to keep track of and terminate workers spawned this way.
 * For termination, use `terminateWorker()`.
 */
export async function spawnWorker(): Promise<Thread & WorkerMethods> {
  return new Promise((resolve, reject) => {
    log.debug("Repositories: Spawning worker");

    spawn<WorkerSpec>(new Worker('../worker/index')).
    then((worker) => {
      Thread.events(worker).subscribe(evt => {
        if (evt.type === 'internalError') {
          log.error("Repositories: Worker error:", evt);
        } else if (evt.type === 'termination') {
          log.warn("Repositories: Worker termination:", evt);
        }
        // TODO: Respawn on worker exit?
      });
      log.debug("Repositories: Spawning worker: Done");
      resolve(worker);
    }).
    catch(reject);
  });
}

export async function terminateWorker(worker: Thread & WorkerMethods) {
  log.debug("Repositories: Terminating worker");
  try {
    await worker.destroy();
  } catch (e) {
    log.error("Repositories: Error terminating worker (suppressed)", e);
  } finally {
    await Thread.terminate(worker);
  }
}


export async function oneOffWorkerTask<Result = any>
(task: (worker: Thread & WorkerMethods) => Promise<Result>) {
  const worker = await spawnWorker();
  const result = await task(worker);
  await terminateWorker(worker);
  return result;
}

// export const syncWorker = initializeWorker();
// export const readerWorker = initializeWorker();
