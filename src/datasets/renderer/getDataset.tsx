import path from 'path';
import log from 'electron-log';
import { remote } from 'electron';
import React from 'react';
import { PluginManager } from 'live-plugin-manager';
import { RendererPlugin, DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import {
  getPluginInfo,
  getPluginManagerProps,
  installPlugin
} from 'plugins';
import { describeRepository, loadRepository } from 'repositories/ipc';
import { DatasetInfo } from '../types';
import { getDatasetInfo, loadDataset } from '../ipc';


export const PLUGINS_PATH = path.join(remote.app.getPath('userData'), 'plugins');


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
  let pluginVersion: string;

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

  } catch (e) {
    log.error("Failed to get extension ID or load extension manager", e);
    throw e;
  }

  // Check plugin’s installed version
  try {
    const pluginInfo = await getPluginInfo.renderer!.trigger({ id: pluginID });

    let _version = pluginInfo.result?.plugin?.installedVersion;
    if (!_version) {
      log.warn("Dataset view: Extension is not installed?", workingCopyPath, pluginID, pluginInfo);
      const installationResult = await installPlugin.renderer!.trigger({ id: pluginID });
      if (installationResult.result && installationResult.result.installed && installationResult.result.installedVersion) {
        _version = installationResult.result.installedVersion;
      } else {
        log.error("Dataset view: Extension could not be installed on the fly", installationResult.errors);
        throw new Error("Required extension could not be installed");
      }
    }

    pluginVersion = _version;

  } catch (e) {
    log.error("Dataset view: Failed to get extension info", pluginID, e);
    throw e;
  }

  const pluginName = pluginID; // TODO: DRY


  // let pluginPath: string | undefined;
  // Install plugin in renderer
  try {
    if (process.env.PANERON_DEV_PLUGIN === undefined) {
      log.silly("Dataset view: Installing plugin for renderer...", workingCopyPath, pluginName, pluginVersion);
      await pluginManager.installFromNpm(pluginName, pluginVersion);
    } else {
      const pluginPath = path.join(PLUGINS_PATH, '@riboseinc', `paneron-extension-${process.env.PANERON_DEV_PLUGIN}`);
      log.silly("Dataset view: (DEV) Installing plugin for renderer...", pluginPath);
      await pluginManager.installFromPath(pluginPath);
    }

    // pluginPath = pluginManager.getInfo(pluginName)?.location;
  } catch (e) {
    log.error("Dataset view: Error installing plugin", workingCopyPath, pluginName, pluginVersion, e);
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
