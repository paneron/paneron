import { makeEndpoint, _, EmptyPayload } from '../ipc';
import { Extension, InstalledPluginInfo } from './types';


// export const NPM_EXTENSION_PREFIX = '@riboseinc/paneron-extension-';


export const getPluginManagerProps = makeEndpoint.main(
  'getPluginManagerProps',
  <EmptyPayload>_,
  <{ cwd?: string, pluginsPath?: string }>_,
)


// Querying

export const listInstalledPlugins = makeEndpoint.main(
  'listInstalledPlugins',
  <EmptyPayload>_,
  <{ objects: InstalledPluginInfo[] }>_,
);


export const listAvailablePlugins = makeEndpoint.main(
  'listAvailablePlugins',
  <EmptyPayload>_,
  <{ extensions: Extension[] }>_,
);


export const getPluginInfo = makeEndpoint.main(
  'getPluginInfo',
  <{ id: string }>_,
  <{ plugin: InstalledPluginInfo | null }>_,
);


// (Un)installation

export const installPlugin = makeEndpoint.main(
  'installPlugin',
  <{ id: string, version?: string }>_,
  <{ installed: true, installedVersion: string }>_,
);


export const upgradePlugin = makeEndpoint.main(
  'upgradePlugin',
  <{ id: string, version?: string }>_,
  <{ installed: true }>_,
);


export const removePlugin = makeEndpoint.main(
  'removePlugin',
  <{ id: string }>_,
  <{ success: true }>_,
);


export const removeAll = makeEndpoint.main(
  'removeAllPlugins',
  <EmptyPayload>_,
  <{ success: true }>_,
);


// Events

export const pluginsUpdated = makeEndpoint.renderer(
  'pluginsChanged',
  <{ changedIDs?: string[] }>_,
);
