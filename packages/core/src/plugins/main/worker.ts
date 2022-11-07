/** Plugins worker handles operations on plugin configuration. */


import { expose } from 'threads/worker';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';

import yaml from 'js-yaml';
import AsyncLock from 'async-lock';

import { Extension, ExtensionRegistry, InstalledPluginInfo } from 'plugins/types';


interface PluginConfigData {
  installedPlugins: {
    [pluginName: string]: Pick<InstalledPluginInfo, 'installedVersion'>
  }
  localPlugins: {
    [pluginName: string]: { localPath: string }
  }
}

const STARTER_PLUGIN_CONFIG: PluginConfigData = {
  installedPlugins: {},
  localPlugins: {},
};

let pluginConfig: PluginConfigData | null = null;

let configPath: string | null = null;

const pluginLock = new AsyncLock();


export interface Methods {

  /** 
   * Initialize plugin manager and config file.
   * Must be called before anything else on freshly started worker.
   */
  initialize: (msg: { pluginsPath: string, pluginConfigPath: string }) => Promise<void>

  /**
   * Adds plugin to the list of installed plugins.
   */
  install: (msg: { name: string, version?: string }) => Promise<{ success: true }>

  remove: (msg: { name: string }) => Promise<{ success: true }>

  removeAll: () => Promise<{ success: true }>

  getInstalledVersion: (msg: { name: string }) => Promise<{ installedVersion: string | null }>

  /** Lists plugins for which local directory paths are specified. */
  listLocalPlugins: () => Promise<ExtensionRegistry>

  /**
   * Associates plugin name with a directory path.
   * If a local path was previously specified for this plugin, it is updated.
   */
  specifyLocalPluginPath: (msg: { directoryPath: string }) => Promise<Extension>

  /**
   * Disassociates plugin name with local directory path.
   * Paneron will try to use NPM version when installing the plugin subsequently.
   */
  removeLocalPlugin: (msg: { pluginName: string }) => Promise<{ success: true }>

}


export type WorkerSpec = ModuleMethods & Methods;


function assertInitialized() {
  if (configPath === null) {
    throw new Error("Plugin worker not initialized");
  }
}


async function readConfig(): Promise<PluginConfigData> {
  assertInitialized();

  if (pluginConfig !== null) {
    return pluginConfig;

  } else {
    let configData: PluginConfigData;
    try {
      const rawData = await fs.readFile(configPath!, { encoding: 'utf-8' });
      configData = yaml.load(rawData) as PluginConfigData;
      if (configData && typeof configData !== 'string' && typeof configData !== 'number') {
      } else {
        console.error("Resetting plugin config (wrong type)", configData, rawData);
        configData = STARTER_PLUGIN_CONFIG;
      }
    } catch (e) {
      console.error("Resetting plugin config (error)", e);
      configData = STARTER_PLUGIN_CONFIG;
    }
    if (configData.installedPlugins === undefined || configData.localPlugins === undefined) {
      console.error("Resetting plugin config (invalid)");
      configData = STARTER_PLUGIN_CONFIG;
    }
    pluginConfig = configData;
    return configData;
  }
}


async function updateConfig(updater: (data: PluginConfigData) => PluginConfigData): Promise<void> {
  assertInitialized();

  const config: PluginConfigData = await readConfig();
  const newConfig = updater(config);
  pluginConfig = newConfig;
  await fs.writeFile(configPath!, yaml.dump(newConfig), { encoding: 'utf-8' });
}


const methods: WorkerSpec = {

  async initialize({ pluginsPath, pluginConfigPath }) {
    configPath = pluginConfigPath;
    await fs.ensureDir(pluginsPath);

    //for (const [name, info] of Object.entries(plugins)) {
    //  if (devFolder && name === devPluginName) {
    //    await manager.installFromPath(path.join(devFolder, name));
    //  } else {
    //    await manager.installFromNpm(name, info.installedVersion || undefined);
    //  }
    //}
  },

  async getInstalledVersion({ name }) {
    return { installedVersion: await getInstalledVersion(name) };
  },


  // Local plugins

  async specifyLocalPluginPath({ directoryPath }) {
    // Also validates that directoryPath contains a valid NPM package
    // and a valid Paneron extension
    const ext = await getExtensionForLocalDirectory(directoryPath);

    // Update plugin configuration
    await updateConfig((data) => {
      const newData: PluginConfigData = {
        ...data,
        localPlugins: {
          ...data.localPlugins,
          [ext.npm.name]: { localPath: directoryPath },
        },
      };
      return newData;
    });

    return ext;
  },

  async removeLocalPlugin({ pluginName }) {
    await updateConfig((data) => {
      const newData = { ...data };
      delete newData.localPlugins[pluginName];
      return newData;
    });

    return { success: true };
  },

  async listLocalPlugins() {
    return await readLocalPlugins();
  },


  // (Un)installation

  async remove({ name }) {
    await pluginLock.acquire('1', async () => {
      assertInitialized();
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
      await updateConfig((data) => {
        const newData = { ...data };
        newData.installedPlugins = {};
        return newData;
      });
    });

    return { success: true };
  },

  // TODO: We blindly return requested version. This method should no longer promise to return installed version.
  async install({ name, version }) {
    await pluginLock.acquire('1', async () => {
      assertInitialized();

      await updateConfig((data) => {
        const newData = { ...data };
        newData.installedPlugins[name] = { installedVersion: version ?? null };
        return newData;
      });

      return version;
    });

    //if (!installedVersion) {
    //  throw new Error("Failed to install");
    //}

    return { success: true };
  },

};


expose(methods);


async function getInstalledVersion(name: string): Promise<string | null> {
  return (await readConfig()).installedPlugins[name]?.installedVersion ?? null;
}


/**
 * Reads local plugins;
 * as a side-effect, confirms directory/metadata validity and removes any invalid plugins.
 */
async function readLocalPlugins(): Promise<ExtensionRegistry> {
  const { localPlugins } = await readConfig();
  const registry: ExtensionRegistry = {};
  const invalidLocalPluginNames: string[] = [];

  for (const [pluginName, { localPath }] of Object.entries(localPlugins)) {
    try {
      const ext = await getExtensionForLocalDirectory(localPath);
      registry[pluginName] = { ...ext, localPath };
    } catch (e) {
      invalidLocalPluginNames.push(pluginName);
    }
  }

  await updateConfig(data => {
    const newData = { ...data };
    for (const pluginName of invalidLocalPluginNames) {
      delete newData.localPlugins[pluginName];
    }
    return newData;
  });

  return registry;
}


// Local plugin management

/** Data contained in package.json */
interface NPMPackage {
  name: string
  version: string
  author: {
    name: string
    email: string
  }
  description: string
  repository: string
  main: string
}

/** Custom Paneron meta extension in package.json’s paneronExtension subkey */
interface PaneronExtensionNPMPackage extends NPMPackage {
  paneronExtension: {
    title: string
    iconURL: string
    featured?: boolean
    requiredHostAppVersion: string
  }
}

/**
 * A function that returns either an error message, or null if data seems valid.
 * Is not expected to throw.
 */
type Validator<T = any> = (data: T) => string | null;

/** Applies validators in order and returns a list of errors. */
function getErrors<T = any>(data: T, validators: Validator<T>[]): string[] {
  return validators.map(rule => rule(data)).filter(err => err !== null) as string[];
}

const NPM_PACKAGE_VALIDATORS: Validator[] = [
  d => d.name === undefined ? "Invalid or missing package name" : null,
  d => d.version === undefined ? "Missing package version" : null,
  d => d.author?.name === undefined ? "Missing or invalid package author" : null,
  d => d.repository === undefined ? "Missing repository reference" : null,
  d => d.main !== 'plugin.js' ? "Unexpected or missing “main” entry" : null,
]
function isNPMPackage(data: any): data is NPMPackage {
  return getErrors(data, NPM_PACKAGE_VALIDATORS).length === 0;
}

const EXTENSION_META_VALIDATORS: ((data: any) => string | null)[] = [
  d => d.paneronExtension === undefined ? "Missing Paneron extension meta" : null,
  d => d.paneronExtension?.title === undefined ? "Missing extension name in Paneron meta" : null,
  d => d.paneronExtension?.iconURL === undefined ? "Missing icon URL in Paneron meta" : null,
  d => d.paneronExtension?.requiredHostAppVersion === undefined ? "Missing host app version requirement in Paneron meta" : null,
]
function isPaneronExtensionNPMPackage(data: any): data is PaneronExtensionNPMPackage {
  return getErrors(data, EXTENSION_META_VALIDATORS).length === 0;
}

/**
 * Given directory path, reads package.json and return extension information.
 * 
 * `latestUpdate` is set to current timestamp.
 * 
 * Throws if directory does not contain a valid NPM package,
 * or the package does not reference a Paneron extension.
 * 
 * Throws
 */
async function getExtensionForLocalDirectory(directoryPath: string): Promise<Extension> {
  const packageJSONPath = path.join(directoryPath, 'package.json');
  try {
    const packageJSONRawData = await fs.readFile(packageJSONPath, { encoding: 'utf-8' });
    const pkg = JSON.parse(packageJSONRawData);
    if (isNPMPackage(pkg)) {
      if (isPaneronExtensionNPMPackage(pkg)) {
        return {
          title: pkg.paneronExtension.title,
          iconURL: pkg.paneronExtension.iconURL,
          requiredHostAppVersion: pkg.paneronExtension.requiredHostAppVersion,
          featured: pkg.paneronExtension.featured ?? false,
          latestUpdate: new Date(),
          npm: pkg,
          author: pkg.author.name,
          description: pkg.description,
        }
      }
    }
    throw new Error("This directory does not seem to contain a valid Paneron extension package");
  } catch (e) {
    throw new Error(`This directory does not seem to contain a valid Paneron extension package (${e})`);
  }
}
