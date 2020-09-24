import { app } from 'electron';
import log from 'electron-log';

import path from 'path';

import { spawn, Worker, Thread } from 'threads';
import { getPluginInfo, getPluginManagerProps, installPlugin, pluginsUpdated } from 'plugins';
import { Methods as WorkerMethods, WorkerSpec } from './worker';


installPlugin.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);

  await (await worker).install({ name });
  await pluginsUpdated.main!.trigger({
    changedIDs: [id],
  });

  return { installed: true };
});


getPluginInfo.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);
  try {
    return await (await worker).getInfo({ name });
  } catch (e) {
    log.error("Cannot fetch plugin info", e, e.code, e.name, e.message);
    throw e;
  }
});


getPluginManagerProps.main!.handle(async () => {
  return {
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  };
});


function getNPMNameForPlugin(pluginID: string): string {
  return `@riboseinc/plugin-${pluginID}`;
}



// Worker

const CWD = app.getPath('userData');
const PLUGINS_PATH = path.join(CWD, 'plugins');
const PLUGIN_CONFIG_PATH = path.join(CWD, 'plugin-config.yaml');

var worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
  log.debug("Plugins: Spawning worker");

  spawn<WorkerSpec>(new Worker('./worker')).
  then((worker) => {
    log.debug("Plugins: Spawning worker: Done");

    async function terminateWorker() {
      await Thread.terminate(worker);
    }

    app.on('quit', terminateWorker);

    Thread.events(worker).subscribe(evt => {
      log.debug("Plugins: Worker event:", evt);
      // TODO: Respawn on worker exit?
    });

    log.debug("Plugins: Initializing worker");

    worker.initialize({
      cwd: CWD,
      pluginsPath: PLUGINS_PATH,
      pluginConfigPath: PLUGIN_CONFIG_PATH,
    }).
    then(() => {
      log.debug("Plugins: Initializing worker: Done");
      resolve(worker);
    }).
    catch(reject);

  }).
  catch(reject);
});
