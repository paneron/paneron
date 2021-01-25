import { spawn, Worker, Thread } from 'threads';
import { app } from 'electron';
import log from 'electron-log';
import WorkerMethods from './worker/types';
import { WorkerSpec } from './worker';


const worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
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

export default worker;
