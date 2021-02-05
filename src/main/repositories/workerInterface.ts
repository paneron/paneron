import { spawn, Worker, Thread } from 'threads';
import { app } from 'electron';
import log from 'electron-log';
import WorkerMethods from './worker/types';
import { WorkerSpec } from './worker';


async function initializeWorker(): Promise<Thread & WorkerMethods> {
  return new Promise((resolve, reject) => {
    log.debug("Repositories: Spawning worker");

    spawn<WorkerSpec>(new Worker('./worker')).
    then((worker) => {
      log.debug("Repositories: Spawning worker: Done");

      async function terminateWorker() {
        log.debug("Repositories: Terminating worker")
        try {
          await worker.destroyWorker();
        } finally {
          await Thread.terminate(worker);
        }
      }

      app.on('quit', terminateWorker);

      Thread.events(worker).subscribe(evt => {
        // log.debug("Repositories: Worker event:", evt);
        // TODO: Respawn on worker exit?
      });

      resolve(worker);
    }).
    catch(reject);
  });
}


// IMPORTANT: Currently, two instances of the same worker are created,
// and care should be taken to use each the right way.
//
// Reader worker is used in stateless lock-free mode, e.g. when raw buffers need to be read.
// Only that subset of methods should be used.
//
// Sync worker is used to load datasets and access logical objects,
// and perform sync (push and pull). This is the one used in endpoints exposed to extensions.
//
// This separation is so that data can be read even if expensive sync operation is ongoing
// (such as pulling a large repository, or dataset object indexing).
//
// This is not a pretty solution.

export const syncWorker = initializeWorker();
export const readerWorker = initializeWorker();
