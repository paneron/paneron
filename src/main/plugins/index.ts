import { app } from 'electron';
import log from 'electron-log';

import fs from 'fs-extra';
import path from 'path';

import { PluginManager } from 'live-plugin-manager';

import { spawn, Worker, Thread } from 'threads';
import { getPluginInfo, getPluginManagerProps, installPlugin, NPM_EXTENSION_PREFIX, pluginsUpdated, upgradePlugin } from 'plugins';
import { Methods as WorkerMethods, WorkerSpec } from './worker';


const devFolder = app.isPackaged === false ? process.env.PANERON_PLUGIN_DIR : undefined;

const devPlugin = app.isPackaged === false ? process.env.PANERON_DEV_PLUGIN : undefined;


if (devFolder) {
  log.warn("Using development plugin folder", devFolder);
}


installPlugin.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);

  const version = await _installPlugin(name);
  (await pluginManager).install(name, version);

  await pluginsUpdated.main!.trigger({
    changedIDs: [id],
  });

  return { installed: true, installedVersion: version };
});


upgradePlugin.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);

  try {
    await _removePlugin(name);
  } catch (e) {
    log.error("Plugins: Upgrade: Error when uninstalling", id)
  }

  (await pluginManager).uninstall(name);
  const version = await _installPlugin(name);
  (await pluginManager).install(name, version);

  await pluginsUpdated.main!.trigger({
    changedIDs: [id],
  });

  return { installed: true };
});


getPluginInfo.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);
  try {
    return await (await worker).getInfo({ name, doOnlineCheck: devFolder === undefined });
  } catch (e) {
    if (id === devPlugin) {
      return {
        id,
        title: id,
        installedVersion: 'dev',
        latestVersion: 'dev',
      };
    } else {
      log.error("Cannot fetch plugin info", name, e, e.code, e.name, e.message);
      throw e;
    }
  }
});


getPluginManagerProps.main!.handle(async () => {
  return {
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  };
});


function getNPMNameForPlugin(pluginID: string): string {
  return `${NPM_EXTENSION_PREFIX}${pluginID}`;
}


async function _installPlugin(name: string): Promise<string> {
  let version: string;
  if (devFolder === undefined) {
    version = (await (await worker).install({ name })).installedVersion;
  } else {
    version = (await (await worker)._installDev({ name, fromPath: devFolder })).installedVersion;
  }

  return version;
}


async function _removePlugin(name: string): Promise<true> {
  (await (await worker).remove({ name }));

  return true;
}



// Worker

const CWD = app.getPath('userData');
const PLUGINS_PATH = path.join(CWD, 'plugins');
const PLUGIN_CONFIG_PATH = path.join(CWD, 'plugin-config.yaml');

const pluginManager: Promise<PluginManager> = new Promise((resolve, _) => {
  resolve(new PluginManager({
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  }));
});

const worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
  log.debug("Plugins: Spawning worker");

  if (devFolder !== undefined) {
    fs.removeSync(PLUGIN_CONFIG_PATH);
    fs.removeSync(PLUGINS_PATH);

    log.debug("Plugins: Cleared paths");
  }

  spawn<WorkerSpec>(new Worker('./worker')).
  then((worker) => {
    log.debug("Plugins: Spawning worker: Done");

    async function terminateWorker() {
      log.debug("Plugins: Terminating worker")
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
      log.debug("Plugins: Installing plugins");

      worker.listInstalledPlugins().
      then((plugins) => {
        pluginManager.
        then(manager => {
          Promise.all(plugins.map(plugin => {
            log.silly("Plugins: Installing in main", plugin.name, plugin.version);
            return new Promise((resolve, reject) => (
              manager.install(plugin.name, plugin.version).
              then(plugin => {
                try {
                  manager.require(plugin.name);
                  resolve(true);
                } catch (e) {
                  log.error("Plugins: Failed to require plugin during init; removing plugin", e)
                  worker.remove({ name: plugin.name }).then(resolve).catch(reject);
                }
              }).
              catch(reject)));
          })).
          then(() => {
            log.debug("Plugins: Initializing worker: Done");
            resolve(worker);
          }).
          catch(reject);
        }).
        catch(reject);
      }).
      catch(reject);
    }).
    catch(reject);
  }).
  catch(reject);
});
