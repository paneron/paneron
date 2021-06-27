import { expose } from 'threads/worker';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';

import yaml from '@riboseinc/paneron-extension-kit/object-specs/yaml';
import AsyncLock from 'async-lock';

import { IPluginInfo, PluginManager } from 'live-plugin-manager';

import { InstalledPluginInfo } from 'plugins/types';


interface PluginConfigData {
  installedPlugins: {
    [pluginName: string]: Pick<InstalledPluginInfo, 'installedVersion'>
  }
}

let manager: PluginManager | null = null;

let configPath: string | null = null;

const pluginLock = new AsyncLock();


export interface Methods {

  /* Initialize plugin manager and config file.
     Must be called before anything else on freshly started worker. */
  initialize: (msg: { cwd: string, pluginsPath: string, pluginConfigPath: string, devFolder?: string }) => Promise<void>

  /* Install latest version if not installed;
     if already installed, do nothing;
     if already installed but version recorded in the configuration does not match installed version, update that;
     return factually installed version. */
  install: (msg: { name: string, version?: string }) => Promise<{ installedVersion: string }>

  /* Development environment helper. Installs from a special path in user’s app data. */
  _installDev: (msg: { name: string, fromPath: string }) => Promise<{ installedVersion: string }>

  remove: (msg: { name: string }) => Promise<{ success: true }>

  removeAll: () => Promise<{ success: true }>

  getInstalledVersion: (msg: { name: string }) => Promise<{ installedVersion: string | null }>

  listInstalledPlugins: () => Promise<IPluginInfo[]>

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

  async initialize({ cwd, pluginsPath, pluginConfigPath, devFolder }) {
    await fs.ensureDir(pluginsPath);
    await fs.ensureFile(pluginConfigPath);

    manager = new PluginManager({
      cwd,
      pluginsPath,
      lockWait: 10000,
    });

    configPath = pluginConfigPath;

    let plugins: PluginConfigData["installedPlugins"]
    try {
      plugins = (await readConfig()).installedPlugins;
    } catch (e) {
      await fs.remove(configPath);
      await updateConfig(() => ({ installedPlugins: {} }));
      plugins = {};
    }

    if (!devFolder) {
      for (const [name, info] of Object.entries(plugins)) {
        await manager.installFromNpm(name, info.installedVersion || undefined);
      }
    } else {
      for (const [name, ] of Object.entries(plugins)) {
        await manager.installFromPath(path.join(devFolder, name));
      }
    }
  },

  async listInstalledPlugins() {
    return await manager!.list();
  },

  async getInstalledVersion({ name }) {
    return { installedVersion: await getInstalledVersion(name) };
  },

  async remove({ name }) {
    await pluginLock.acquire('1', async () => {
      assertInitialized();

      (await manager!.uninstall(name));

      await updateConfig((data) => {
        const newData = { ...data };
        delete newData.installedPlugins[name];
        return newData;
      });
    });

    return { success: true };
  },

  async removeAll() {
    await pluginLock.acquire('1', async () => {
      assertInitialized();

      (await manager!.uninstallAll());

      await updateConfig((data) => {
        const newData = { ...data };
        newData.installedPlugins = {};
        return newData;
      });
    });

    return { success: true };
  },

  async install({ name, version }) {
    const installedVersion: string | undefined = await pluginLock.acquire('1', async () => {
      assertInitialized();

      let installedVersion: string | undefined;

      if (version === undefined) {
        const foundVersion = manager!.getInfo(name)?.version;
        if (foundVersion) {
          installedVersion = foundVersion;
        } else {
          await manager!.installFromNpm(name);
          installedVersion = manager!.getInfo(name)?.version;
        }
      } else {
        await manager!.installFromNpm(name, version);
        installedVersion = manager!.getInfo(name)?.version;
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

      console.debug("Plugins: Worker: Installing in dev mode…", path.join(fromPath, name));

      const { version } = await manager!.installFromPath(path.join(fromPath, name));

      console.debug("Plugins: Worker: Installed in dev mode", path.join(fromPath, name), version);

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
        throw new Error("Failed to install in dev mode");
      }
      return version;
    });
    return { installedVersion };
  },

};


expose(methods);


async function getInstalledVersion(name: string): Promise<string | null> {
  return (await readConfig()).installedPlugins[name]?.installedVersion || null;
}
