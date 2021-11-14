import log from 'electron-log';
import React from 'react';
import { PluginManager } from 'live-plugin-manager';
import { RendererPlugin, DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import {
  getPluginManagerProps,
  listLocalPlugins,
  removePlugin,
} from 'plugins';
import { describeRepository, loadRepository } from 'repositories/ipc';
import { DatasetInfo } from '../types';
import { getDatasetInfo, loadDataset } from '../ipc';


export default async function getDataset(workingCopyPath: string, datasetPath?: string): Promise<{
  writeAccess: boolean;
  dataset: DatasetInfo;
  MainView: React.FC<DatasetContext & { className?: string }>;
  getObjectView: RendererPlugin["getObjectView"];
}> {

  if (workingCopyPath === '') {
    throw new Error("Invalid repository working copy path");
  }

  let MainView: React.FC<DatasetContext & { className?: string }>;
  let writeAccess: boolean;
  let dataset: DatasetInfo;
  let getObjectView: RendererPlugin["getObjectView"];

  let pluginManager: PluginManager;
  let pluginID: string;
  let pluginVersion: string | undefined;

  // Prepare plugin info and manager
  try {
    await loadRepository.renderer!.trigger({ workingCopyPath });
    const [repoInfo, datasetInfo, pluginManagerProps] = await Promise.all([
      describeRepository.renderer!.trigger({ workingCopyPath }),
      getDatasetInfo.renderer!.trigger({ workingCopyPath, datasetPath }),
      getPluginManagerProps.renderer!.trigger({}),
    ]);

    const _gitRepoInfo = repoInfo.result?.info.gitMeta;
    const _datasetInfo = datasetInfo.result?.info;

    if (!_gitRepoInfo) {
      throw new Error("This does not seem to be a Paneron repository");
    }
    if (!_datasetInfo) {
      throw new Error("This does not seem to be a Paneron dataset");
    }

    const _pluginID = _datasetInfo.type.id;
    const cwd = pluginManagerProps.result?.cwd;
    const pluginsPath = pluginManagerProps.result?.pluginsPath;

    if (!_pluginID) {
      throw new Error("Dataset does not specify type");
    }
    if (!pluginsPath || !cwd) {
      throw new Error("Error configuring extension manager");
    }

    writeAccess = _gitRepoInfo.remote === undefined || _gitRepoInfo.remote.writeAccess === true;
    dataset = _datasetInfo;

    pluginManager = new PluginManager({ cwd, pluginsPath });
    pluginID = _pluginID;

    // NOTE: We’ll always install latest extension version. Extension should maintain backwards compatibility.
    // TODO: Take into account dataset schema version and install latest extension version still compatible with specified schema version?
    // pluginVersion = _datasetInfo.type.version;
    pluginVersion = undefined;

  } catch (e) {
    log.error("Failed to get extension ID or load extension manager", e);
    throw e;
  }

  const pluginName = pluginID; // TODO: DRY


  // let pluginPath: string | undefined;
  // Install plugin in renderer
  try {
    // NOTE: This requires `nodeIntegration` to be true on Electron’s window.
    // Ideally, we want to get rid of that.
    const { result: localPlugins } = await listLocalPlugins.renderer!.trigger({});
    if (!localPlugins[pluginName]?.localPath) {
      log.silly("Dataset view: Installing plugin for renderer...", workingCopyPath, pluginName, pluginVersion);
      await pluginManager.installFromNpm(pluginName, pluginVersion);
    } else {
      const localPath = localPlugins[pluginName].localPath!;
      log.silly("Dataset view: (Re)installing plugin for renderer (local)...", workingCopyPath, pluginName, localPath, pluginVersion);
      await removePlugin.renderer!.trigger({ id: pluginName });
      await pluginManager.installFromPath(localPath);
    }

    // pluginPath = pluginManager.getInfo(pluginName)?.location;
  } catch (e) {
    log.error("Dataset view: Error installing plugin for renderer", workingCopyPath, pluginName, pluginVersion, e);
    throw new Error("Error loading extension");
  }

  // if (!pluginPath) {
  //   log.error("Repository view: Cannot get plugin path");
  //   throw new Error("Cannot get extension module file path");
  // }
  // Require plugin
  try {
    log.silly("Dataset view: Requiring renderer plugin...", pluginName);
    const pluginPromise: RendererPlugin = pluginManager.require(pluginName).default;

    // Experiment with using plain remote did not work so well so far.
    //const pluginPromise: RendererPlugin = global.require(path.resolve(`${pluginPath}/plugin`)).default;
    log.silly("Dataset view: Awaiting renderer plugin...", pluginPromise);
    const plugin = await pluginPromise;

    if (!plugin.mainView) {
      log.error("Dataset view: Not provided by plugin", pluginName, pluginVersion);
      throw new Error("Error requesting main dataset view from Paneron extension");
    }

    MainView = plugin.mainView;
    getObjectView = plugin.getObjectView;
    log.silly("Dataset view: Got renderer plugin and dataset view", plugin);

    log.silly("Dataset view: Loading dataset…");
    const dataset = (await loadDataset.renderer!.trigger({
      workingCopyPath,
      datasetPath: datasetPath!,
    })).result;
    if (!dataset || !dataset.success) {
      throw new Error("Unable to load dataset");
    }

  } catch (e) {
    log.error("Dataset view: Error requiring plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw e;
  }

  return { MainView, writeAccess, dataset, getObjectView };
}
