import rax from 'retry-axios';
import _axios from 'axios';

import { app } from 'electron';
import log from 'electron-log';

import fs from 'fs-extra';
import path from 'path';

import compareDesc from 'date-fns/compareDesc';
import parseJSON from 'date-fns/parseJSON';

import { PluginManager } from 'live-plugin-manager';

import { spawn, Worker, Thread } from 'threads';
import { MainPlugin } from '@riboseinc/paneron-extension-kit/types';
import {
  getPluginInfo, getPluginManagerProps,
  installPlugin, listAvailablePlugins,
  listLocalPlugins,
  pluginsUpdated, removeLocalPluginPath, removePlugin, specifyLocalPluginPath, upgradePlugin,
} from '../../plugins';
import { Extension, ExtensionRegistry } from '../../plugins/types';
import { Methods as WorkerMethods, WorkerSpec } from './worker';


const axios = _axios.create({ timeout: 10000 });
axios.defaults.raxConfig = {
  instance: axios,
};
rax.attach(axios);


listAvailablePlugins.main!.handle(async () => {
  const packages = await fetchExtensions();

  const extensions: Extension[] = Object.entries(packages).
  sort(([_0, ext1], [_1, ext2]) => compareDesc(parseJSON(ext1.latestUpdate), parseJSON(ext2.latestUpdate))).
  map(([_, ext]) => ext);

  return {
    extensions,
  };
});


installPlugin.main!.handle(async ({ id, version: versionToInstall }) => {
  const name = id;

  try {
    await _installPlugin(name, versionToInstall);
  } finally {
    await pluginsUpdated.main!.trigger({
      changedIDs: [id],
    });
  }

  return { installed: true };
});


removePlugin.main!.handle(async ({ id }) => {
  await _removePlugin(id);
  await pluginsUpdated.main!.trigger({
    changedIDs: [id],
  });
  return { success: true };
});


upgradePlugin.main!.handle(async ({ id, version: versionToUpgradeTo }) => {
  const name = id;

  try {
    await _removePlugin(name);
  } catch (e) {
    log.error("Plugins: Upgrade: Error when uninstalling", id)
  }

  try {
    await _installPlugin(name, versionToUpgradeTo);
  } finally {
    await pluginsUpdated.main!.trigger({
      changedIDs: [id],
    });
  }

  return { installed: true };
});


getPluginInfo.main!.handle(async ({ id }) => {
  const name = id;

  if (!name) {
    return { plugin: null };
  }

  const w = await worker;

  const localPlugins = await (await worker).listLocalPlugins();

  let ext: Extension | undefined;

  const localPlugin = localPlugins[id];
  if (localPlugin) {
    ext = localPlugin;
  } else {
    try {
      const extensions = await fetchExtensions();
      ext = extensions[name];
    } catch (e) {
      log.error("Plugins: Unable to fetch Paneron extension index", e);
      return { plugin: null };
    }
  }

  if (ext) {
    const isLocal = localPlugin !== undefined ? true : undefined;
    try {
      const { installedVersion } = await w.getInstalledVersion({ name });
      return { plugin: { ...ext, installedVersion, isLocal } };
    } catch (e) {
      log.error("Unable to fetch information about installed extension version", name);
      return { plugin: { ...ext, installedVersion: null, isLocal } };
    }
  } else {
    log.error("Plugins: Cannot locate extension in Paneron extension index", name);
    return { plugin: null };
  }
});


getPluginManagerProps.main!.handle(async () => {
  return {
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  };
});


// Local plugins

specifyLocalPluginPath.main!.handle(async ({ directoryPath }) => {
  const ext = await (await worker).specifyLocalPluginPath({ directoryPath });
  await _removePlugin(ext.npm.name);
  await pluginsUpdated.main!.trigger({});
  return ext;
});

removeLocalPluginPath.main!.handle(async ({ pluginName }) => {
  await _removePlugin(pluginName);
  const result = await (await worker).removeLocalPlugin({ pluginName });
  await pluginsUpdated.main!.trigger({});
  return result;
});

listLocalPlugins.main!.handle(async () => {
  return await (await worker).listLocalPlugins();
});


// (Un)installation helpers

async function _installPlugin(name: string, versionToInstall?: string): Promise<void> {
  const w = await worker;
  const localPlugins = await w.listLocalPlugins();
  const localPlugin = localPlugins[name];

  (await w.install({ name, version: versionToInstall }));

  if (!localPlugin?.localPath) {
    log.debug("Plugins: installing...", name);
    await (await pluginManager).install(name);
  } else {
    log.debug("Plugins: installing (local)...", name, localPlugin.localPath);
    await (await pluginManager).installFromPath(localPlugin.localPath);
  }

  return;
}


async function _removePlugin(name: string): Promise<true> {
  (await (await worker).remove({ name }));

  await (await pluginManager).uninstall(name);

  //delete _runtimePluginInstanceCache[name];

  return true;
}



// Requiring plugins in main thread

const _runtimePluginInstanceCache: Record<string, MainPlugin> = {};

function _getPluginCacheKey(name: string, version?: string) {
  const cacheKey = `${name}@${version ?? ''}`;
  return cacheKey;
}

const _appVersion = process.env.NODE_ENV === 'development'
  ? process.env.npm_package_version!
  : app.getVersion();

export async function requireMainPlugin(name: string, version?: string): Promise<MainPlugin> {
  const cacheKey = _getPluginCacheKey(name, version);
  if (!_runtimePluginInstanceCache[cacheKey]) {
    log.debug("Plugins: Require main plugin: Instance not cached");

    const { installedVersion } = await (await worker).getInstalledVersion({ name });
    if (!installedVersion) {
      log.warn("Plugins: Requiring main plugin that is not installed", name, version);
      await _installPlugin(name, version);
      if (!installedVersion) {
        log.error("Plugins: Requiring main plugin that is not installed, and could not be installed on demand", name, version);
        throw new Error("Extension is not installed");
      } else {
        log.info("Plugins: Installed main plugin on demand", name, version);
      }
    }

    if (version !== undefined && installedVersion !== version) {
      log.warn("Plugins: Requiring main plugin: Requested version is different from installed, reinstalling", name, version);
      await _removePlugin(name);
      await _installPlugin(name, version);
      //throw new Error("Installed extension version is different from requested");
    }

    // TODO: Cache each plugin instance at runtime
    const plugin: MainPlugin = await (await pluginManager).require(name).default;
    log.silly("Plugins: Required main plugin", name, version, plugin);

    if (!plugin.isCompatible(_appVersion)) {
      log.error(
        "Plugins: Extension version is not compatible with host application version",
        `${name}@${version || '??'}`,
        _appVersion);
      throw new Error("Extension version is not compatible with host application version");
    }

    _runtimePluginInstanceCache[cacheKey] = plugin;

  } else {
    log.debug("Plugins: Require main plugin: Got cached instance");
  }

  return _runtimePluginInstanceCache[cacheKey];
}



// Plugin manager

const CWD = app.getPath('userData');
const PLUGINS_PATH = path.join(CWD, 'plugins');
const PLUGIN_CONFIG_PATH = path.join(CWD, 'plugin-config.yaml');

function clearLockfile() {
  log.debug("Plugins: Clearing lockfile");
  fs.removeSync(path.join(PLUGINS_PATH, 'install.lock'));
}

export async function clearPluginData() {
  clearLockfile();
  fs.rmdirSync(PLUGINS_PATH, { recursive: true });
  fs.removeSync(PLUGIN_CONFIG_PATH);
}

export const pluginManager: Promise<PluginManager> = new Promise((resolve, _) => {
  resolve(new PluginManager({
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
    npmInstallMode: 'useCache',
  }));
});

clearLockfile();
app.on('quit', clearLockfile);



// Querying extension directory

async function fetchPublishedExtensions(): Promise<ExtensionRegistry> {
  return (await axios.get("https://extensions.paneron.org/extensions.json")).data.extensions;
}

export async function fetchExtensions(): Promise<ExtensionRegistry> {
  let publishedExtensions: ExtensionRegistry
  try {
    publishedExtensions = await fetchPublishedExtensions();
  } catch (e) {
    log.error("Plugins: Unable to fetch published extensions", e);
    publishedExtensions = {};
  }
  const localExtensions = await (await worker).listLocalPlugins();
  return {
    ...publishedExtensions,
    ...localExtensions,
  };
}



// Worker

export const worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
  log.debug("Plugins: Spawning worker");

  spawn<WorkerSpec>(new Worker('./worker')).
  then((worker) => {
    log.debug("Plugins: Spawning worker: Done");

    async function terminateWorker() {
      log.debug("Plugins: Terminating worker");
      await Thread.terminate(worker);
    }

    app.on('quit', terminateWorker);

    Thread.events(worker).subscribe(evt => {
      if (evt.type === 'internalError') {
        log.error("Plugins: Worker error:", evt);
      } else if (evt.type === 'termination') {
        log.warn("Plugins: Worker termination:", evt);
      }
      // TODO: Respawn on worker exit?
    });

    log.debug("Plugins: Initializing worker", CWD, PLUGINS_PATH, PLUGIN_CONFIG_PATH);

    worker.initialize({
      pluginsPath: PLUGINS_PATH,
      pluginConfigPath: PLUGIN_CONFIG_PATH,
    }).
    then(() => {
      log.debug("Plugins: Init: Worker initialized");
      resolve(worker);
    }).
    catch(reject);
  }).
  catch(reject);
});
