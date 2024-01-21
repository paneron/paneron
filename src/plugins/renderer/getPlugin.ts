import path from 'path';
import fs from 'fs-extra';
import { PluginManager } from 'live-plugin-manager';
import { ImportMapper } from 'import-mapper';
import type { RendererPlugin } from '@riboseinc/paneron-extension-kit/types';
import {
  getPluginManagerProps,
  installPlugin,
  listLocalPlugins,
  removePlugin,
  getPackageCode,
} from 'plugins';


/**
 * Loads and returns extension API endpoint
 * given extension NPM package name & version.
 */
export default async function getPlugin(id: string, version: string | undefined): Promise<RendererPlugin> {
  const pluginManagerProps = await getPluginManagerProps.renderer!.trigger({});
  const { cwd, pluginsPath } = pluginManagerProps.result;
  if (!cwd || !pluginsPath) {
    throw new Error("Unable to obtain plugin manager props");
  }

  try {

    // New way

    console.time("Load new-style packaged extension");

    const { result: { code } } = await getPackageCode.renderer!.trigger({ id });

    await setUpDeps();

    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const { 'default': plugin } = await import(/* webpackIgnore: true */ url);

    console.timeEnd("Load new-style packaged extension");

    console.info("Successfully loaded new-style packaged extension");

    return parsePlugin(await plugin);

  } catch (e) {

    // Old way

    console.error("Unable to load new-style packaged extension due to an error:", e);

    console.time("Install legacy extension via NodeJS & NPM package");

    const pluginManager = new PluginManager({
      cwd,
      pluginsPath,
      sandbox: { global: global as any },
    });

    // NOTE: This requires `nodeIntegration` to be true on Electron’s window.
    // Ideally, we want to get rid of that.
    const { result: localPlugins } = await listLocalPlugins.renderer!.trigger({});

    if (!localPlugins[id]?.localPath) {
      console.debug("Dataset view: Installing plugin for renderer...", id, version);
      const { version: installedVersion } = await pluginManager.installFromNpm(id, version);
      await installPlugin.renderer!.trigger({ id, version: installedVersion });

    } else {

      const localPath = localPlugins[id].localPath!;
      const installedVersion = localPlugins[id].npm.version;

      console.debug("Dataset view: (Re)installing plugin for renderer (local)...", id, version);

      const pluginLocation = (
        pluginManager.getInfo(id)?.location ??
        path.join(
          pluginManager.options.pluginsPath,
          id.split(path.posix.sep).join(path.sep)));

      // Clean up the plugin in filesystem

      console.debug("Dataset view: Removing plugin from FS", pluginLocation);

      if (pluginLocation) {
        if (pluginLocation.startsWith(pluginManager.options.pluginsPath)) {
          try {
            fs.removeSync(pluginLocation);
          } catch (e) {
            console.debug("Dataset view: Removing plugin from FS: error", e);
          }
        } else {
          throw new Error("Can’t remove plugin (plugin path is not a descendant of root plugin path)");
        }
      }

      await pluginManager.uninstall(id);
      await removePlugin.renderer!.trigger({ id });

      await installPlugin.renderer!.trigger({ id, version: installedVersion });
      await pluginManager.installFromPath(localPath);
    }

    console.timeEnd("Install legacy extension via NodeJS & NPM package");

    return parsePlugin(await pluginManager.require(id).default);
  }
}


const global = {
  atob,
  btoa,
  console: {
    debug: (...args: any[]) => console.debug(...args),
    log: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
  },
  Object,
  Array,
  ArrayBuffer,
  Boolean,
  Date,
  Error,
  Function,
  JSON,
  Infinity,
  Intl,
  Map,
  Math,
  NaN,
  Number,
  Promise,
  RegExp,
  Set,
  String,
  Symbol,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  WeakMap,
  WeakSet,
};


function parsePlugin(plugin: any): RendererPlugin {
  // Validate the extension roughly
  if (!plugin.mainView) {
    console.error("Dataset view: Not provided by plugin", plugin.mainView);
    throw new Error("Error requesting main dataset view from Paneron extension");
  } else {
    console.debug("Got plugin", plugin);
    return plugin as RendererPlugin;
  }
}


// To make dependencies importable within dynamically imported extension code

/** Returns an object with all imports allowed within an extension. */
async function getDeps(): Promise<Record<string, unknown>> {
  return {
    'react': await import('react'),
    '@emotion/styled': await import('@emotion/styled'),
    '@emotion/react': await import('@emotion/react'),
    '@blueprintjs/core': await import('@blueprintjs/core'),
    '@blueprintjs/popover2': await import('@blueprintjs/popover2'),
    '@blueprintjs/select': await import('@blueprintjs/select'),
    'react-mathjax2': await import('react-mathjax2'),
    'liquidjs': await import('liquidjs'),
    'js-yaml': await import('js-yaml'),
    'asciidoctor': await import('asciidoctor'),
    'immutability-helper': await import('immutability-helper'),
    'date-fns/format': await import('date-fns/format'),
    'date-fns/parse': await import('date-fns/parse'),

    'effect': await import('effect'),
    '@effect/schema': await import('@effect/schema'),

    '@riboseinc/paneron-extension-kit': await import('@riboseinc/paneron-extension-kit'),
    '@riboseinc/paneron-registry-kit': await import('@riboseinc/paneron-registry-kit'),
    '@riboseinc/paneron-registry-kit/migrations/initial': await import('@riboseinc/paneron-registry-kit/migrations/initial'),
    '@riboseinc/paneron-registry-kit/views': await import('@riboseinc/paneron-registry-kit/views'),
    '@riboseinc/paneron-registry-kit/views/FilterCriteria/CRITERIA_CONFIGURATION': await import('@riboseinc/paneron-registry-kit/views/FilterCriteria/CRITERIA_CONFIGURATION'),
    '@riboseinc/paneron-registry-kit/views/util': await import('@riboseinc/paneron-registry-kit/views/util'),
    '@riboseinc/paneron-registry-kit/views/BrowserCtx': await import('@riboseinc/paneron-registry-kit/views/BrowserCtx'),
    '@riboseinc/paneron-registry-kit/views/itemPathUtils': await import('@riboseinc/paneron-registry-kit/views/itemPathUtils'),
    '@riboseinc/paneron-extension-kit/context': await import('@riboseinc/paneron-extension-kit/context'),
  };
}

/**
 * Uses importMapper to make select dependencies available within code
 * that was dynamically `import()`ed from an object URL
 * (see `plugins.renderer.getPlugin()` for where that happens).
 */
async function setUpDeps() {
  const deps = await getDeps();

  const imports: Record<string, string> = {};
  for (const [moduleID, moduleData] of Object.entries(deps)) {
    const m = moduleData as any;
    const d = m.default // && Object.keys(m).length === 1 // only default export
      ? ImportMapper.forceDefault(m.default)
      : null;
    if (d || moduleData) {
      imports[moduleID] = d ?? moduleData;
    }
  }

  const mapper = new ImportMapper(imports);
  mapper.register();
}
