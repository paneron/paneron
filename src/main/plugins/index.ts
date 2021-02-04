import axios from 'axios';

import { app } from 'electron';
import log from 'electron-log';

import fs from 'fs-extra';
import path from 'path';

import compareDesc from 'date-fns/compareDesc';
import parseJSON from 'date-fns/parseJSON';

import { PluginManager } from 'live-plugin-manager';

import { spawn, Worker, Thread } from 'threads';
import {
  getPluginInfo, getPluginManagerProps,
  installPlugin, listAvailablePlugins,
  pluginsUpdated, upgradePlugin,
} from 'plugins';
import { Methods as WorkerMethods, WorkerSpec } from './worker';
import { Extension } from 'plugins/types';
import { MainPlugin } from '@riboseinc/paneron-extension-kit/types';


const devFolder = app.isPackaged === false ? process.env.PANERON_PLUGIN_DIR : undefined;

const devPluginName = app.isPackaged === false ? process.env.PANERON_DEV_PLUGIN : undefined;

const devPlugin = devPluginName
  ? {
      title: devPluginName,
      author: 'You',
      description: "Your test plugin",
      latestUpdate: new Date(),
      featured: true,
      iconURL: "https://open.ribose.com/assets/favicon-192x192.png",
      requiredHostAppVersion: app.getVersion(),
      npm: {
        name: '__your-test-plugin',
        bugs: { url: "https://open.ribose.com/" },
        version: '0.0.0',
        dist: {
          shasum: '000',
          integrity: '000',
          unpackedSize: 10000,
          'npm-signature': '000',
        },
      },
    }
  : undefined;


if (devFolder) {
  log.warn("Using development plugin folder", devFolder);
}


let _extensionCache: { [packageID: string]: Extension } | undefined = undefined;

export async function fetchExtensions(): Promise<{ [packageID: string]: Extension }> {
  if (_extensionCache === undefined) {
    _extensionCache = (
      (await axios.get("https://extensions.paneron.org/extensions.json")).
      data.extensions);
  }
  return _extensionCache!;
}


listAvailablePlugins.main!.handle(async () => {
  const packages = await fetchExtensions();

  const extensions: Extension[] = Object.entries(packages).
  sort(([_0, ext1], [_1, ext2]) => compareDesc(parseJSON(ext1.latestUpdate), parseJSON(ext2.latestUpdate))).
  map(([_, ext]) => ext);

  const _devPlugin: Extension[] = devPlugin ? [devPlugin] : [];

  return {
    extensions: [ ...extensions, ..._devPlugin ],
  };
});


installPlugin.main!.handle(async ({ id, version: versionToInstall }) => {
  const name = id;

  let version: string;

  try {
    version = await _installPlugin(name, versionToInstall);
  } finally {
    await pluginsUpdated.main!.trigger({
      changedIDs: [id],
    });
  }

  (await pluginManager).install(name, version);

  return { installed: true, installedVersion: version };
});


upgradePlugin.main!.handle(async ({ id, version: versionToUpgradeTo }) => {
  const name = id;

  try {
    await _removePlugin(name);
  } catch (e) {
    log.error("Plugins: Upgrade: Error when uninstalling", id)
  }

  (await pluginManager).uninstall(name);

  let version: string;
  try {
    version = await _installPlugin(name, versionToUpgradeTo);
  } finally {
    await pluginsUpdated.main!.trigger({
      changedIDs: [id],
    });
  }

  (await pluginManager).install(name, version);

  return { installed: true };
});


getPluginInfo.main!.handle(async ({ id }) => {
  const name = id;
  const w = await worker;
  if (name === devPluginName && devPlugin) {
    return { plugin: { ...devPlugin, installedVersion: '0.0.0' } };
  } else {
    const extensions = await fetchExtensions();
    const ext = extensions[name];
    if (ext) {
      const { installedVersion } = await w.getInstalledVersion({ name });
      return { plugin: { ...ext, installedVersion } };
    } else {
      log.error("Cannot locate extension in Paneron index", name);
      return { plugin: null };
    }
  }
});


getPluginManagerProps.main!.handle(async () => {
  return {
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  };
});


// function getNPMNameForPlugin(pluginID: string): string {
//   return `${NPM_EXTENSION_PREFIX}${pluginID}`;
// }


async function _installPlugin(name: string, versionToInstall?: string): Promise<string> {
  let version: string;
  if (devFolder === undefined) {
    version = (await (await worker).install({ name, version: versionToInstall })).installedVersion;
  } else {
    version = (await (await worker)._installDev({ name, fromPath: devFolder })).installedVersion;
  }

  return version;
}


async function _removePlugin(name: string): Promise<true> {
  (await (await worker).remove({ name }));

  return true;
}


export async function requireMainPlugin(name: string, version?: string): Promise<MainPlugin> {
  const { installedVersion } = await (await worker).getInstalledVersion({ name });
  if (!installedVersion) {
    log.error("Plugins: Requiring main plugin that is not installed", name);
    throw new Error("Extension is not installed");
  }

  if (version !== undefined && installedVersion !== version) {
    log.error("Plugins: Requiring main plugin: requested version is different from installed", name, version);
    throw new Error("Installed extension version is different from requested");
  }

  const plugin: MainPlugin = await (await pluginManager).require(name).default;
  log.silly("Plugins: Required main plugin", name, version, plugin);

  return plugin;
}



// Plugin manager

const CWD = app.getPath('userData');
const PLUGINS_PATH = path.join(CWD, 'plugins');
const PLUGIN_CONFIG_PATH = path.join(CWD, 'plugin-config.yaml');

export const pluginManager: Promise<PluginManager> = new Promise((resolve, _) => {
  resolve(new PluginManager({
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  }));
});


// Worker

export const worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
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
