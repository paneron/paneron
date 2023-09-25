import path from 'path';
import fs from 'fs-extra';
import { PluginManager } from 'live-plugin-manager';
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

    const { result: { code } } = await getPackageCode.renderer!.trigger({ id });
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const { 'default': plugin } = await import(/* webpackIgnore: true */ url);

    return parsePlugin(await plugin);

  } catch (e) {

    // Old way

    console.warn("Using legacy extension: requiring via NPM package");

    const pluginManager = new PluginManager({ cwd, pluginsPath });

    // NOTE: This requires `nodeIntegration` to be true on Electron’s window.
    // Ideally, we want to get rid of that.
    const { result: localPlugins } = await listLocalPlugins.renderer!.trigger({});

    if (!localPlugins[id]?.localPath) {
      console.debug("Dataset view: Installing plugin for renderer...", id, version);
      const { version: installedVersion } = await pluginManager.installFromNpm(id, version);
      await installPlugin.renderer!.trigger({ id, version: installedVersion });

    } else {

      // Old way
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

    return parsePlugin(await pluginManager.require(id).default);
  }
}


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
