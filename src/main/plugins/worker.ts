import { expose } from 'threads/worker';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';

import * as yaml from 'js-yaml';
import AsyncLock from 'async-lock';

import { PluginManager } from 'live-plugin-manager';

import { PluginInfo } from 'plugins/types';


interface InstalledPlugins {
  [pluginName: string]: {
    installedVersion: string
  }
}

interface PluginConfigData {
  installedPlugins: InstalledPlugins
}

//let plugins: InstalledPlugins = {}

let manager: PluginManager | null = null;

let configPath: string | null = null;

const pluginLock = new AsyncLock();


export interface Methods {
  /* Initialize plugin manager and config file.
     Must be called before anything else on freshly started worker. */
  initialize: (msg: { cwd: string, pluginsPath: string, pluginConfigPath: string }) => Promise<void>

  /* Install latest version if not installed;
     if already installed, do nothing;
     if already installed but version recorded in the configuration does not match installed version, update that;
     return factually installed version. */
  install: (msg: { name: string }) => Promise<{ installedVersion: string }>

  /* Development environment helper. Installs from a special path in user’s app data. */
  _installDev: (msg: { name: string, fromPath: string }) => Promise<{ installedVersion: string }>

  /* Returns information about a plugin, either installed or from NPM */
  getInfo: (msg: { name: string }) => Promise<PluginInfo>
}


export type WorkerSpec = ModuleMethods & Methods;


function assertInitialized() {
  if (manager === null || configPath === null) {
    throw new Error("Plugin worker not initialized");
  }
}


async function readConfig(): Promise<PluginConfigData> {
  assertInitialized();

  let configData: PluginConfigData;
  try {
    const rawData = await fs.readFile(configPath!, { encoding: 'utf-8' });
    configData = yaml.load(rawData);
  } catch (e) {
    return { installedPlugins: {} };
  }
  if (configData.installedPlugins === undefined) {
    return { installedPlugins: {} };
  }
  return configData;
}


async function updateConfig(updater: (data: PluginConfigData) => PluginConfigData): Promise<void> {
  assertInitialized();

  const config: PluginConfigData = await readConfig();
  const newConfig = updater(config);
  await fs.writeFile(configPath!, yaml.dump(newConfig), { encoding: 'utf-8' });
}


const methods: WorkerSpec = {

  async initialize({ cwd, pluginsPath, pluginConfigPath }) {
    await fs.ensureDir(pluginsPath);
    await fs.ensureFile(pluginConfigPath);

    manager = new PluginManager({
      cwd,
      pluginsPath,
      lockWait: 10000,
    });

    configPath = pluginConfigPath;

    let plugins: InstalledPlugins;
    try {
      plugins = (await readConfig()).installedPlugins;
    } catch (e) {
      await fs.remove(configPath);
      await updateConfig(() => ({ installedPlugins: {} }));
      plugins = {};
    }

    for (const [name, info] of Object.entries(plugins)) {
      await manager.installFromNpm(name, info.installedVersion);
    }
  },

  async getInfo({ name }) {
    const installedVersion = (await readConfig()).installedPlugins[name]?.installedVersion;
    if (installedVersion) {
      return {
        id: name,
        title: name,
        installedVersion,
      };
    } else {
      const npmInfo = await manager!.queryPackageFromNpm(name);
      return {
        id: npmInfo.name,
        title: npmInfo.name,
      };
    }
  },

  async install({ name }) {
    const installedVersion: string | undefined = await pluginLock.acquire('1', async () => {
      assertInitialized();

      let installedVersion: string | undefined;

      const foundVersion = (await manager!.getInfo(name))?.version;
      if (foundVersion) {
        installedVersion = foundVersion;

      } else {
        await manager!.installFromNpm(name);
        installedVersion = (await manager!.getInfo(name))?.version;
      }

      await updateConfig((data) => {
        const newData = { ...data };

        if (installedVersion === undefined) {
          delete newData.installedPlugins[name];
        } else if (installedVersion !== newData.installedPlugins[name]?.installedVersion) {
          newData.installedPlugins[name] = { installedVersion };
        }

        return newData;
      });

      return installedVersion;
    });

    if (!installedVersion) {
      throw new Error("Failed to install");
    }

    return { installedVersion };
  },

  async _installDev({ name, fromPath }) {
    // TODO: DRY
    const installedVersion: string | undefined = await pluginLock.acquire('1', async () => {
      assertInitialized();

      const { version } = await manager!.installFromPath(path.join(fromPath, name));

      await updateConfig((data) => {
        const newData = { ...data };

        if (version === undefined) {
          delete newData.installedPlugins[name];
        } else if (version !== newData.installedPlugins[name]?.installedVersion) {
          newData.installedPlugins[name] = { installedVersion: version };
        }
        return newData;
      });

      if (!version) {
        throw new Error("Failed to install");
      }
      return version;
    });
    return { installedVersion };
  },

};


expose(methods);
