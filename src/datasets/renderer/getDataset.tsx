import React from 'react';
import type { RendererPlugin, DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import { describeRepository, loadRepository } from 'repositories/ipc';
import getPlugin from 'plugins/renderer/getPlugin';
import { DatasetInfo } from '../types';
import { getDatasetInfo, loadDataset } from '../ipc';


export default async function getDataset(workingCopyPath: string, datasetID: string): Promise<{
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

  let pluginID: string;
  let pluginVersion: string | undefined;

  await loadRepository.renderer!.trigger({ workingCopyPath });

  // Prepare plugin info
  try {
    const [repoInfo, datasetInfo] = await Promise.all([
      describeRepository.renderer!.trigger({ workingCopyPath }),
      getDatasetInfo.renderer!.trigger({ workingCopyPath, datasetID }),
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

    if (!_pluginID) {
      throw new Error("Dataset does not specify type");
    }

    writeAccess = _gitRepoInfo.remote === undefined || _gitRepoInfo.remote.writeAccess === true;
    dataset = _datasetInfo;

    pluginID = _pluginID;

    // NOTE: We’ll always install latest extension version. Extension should maintain backwards compatibility.
    // TODO: Take into account dataset schema version and install latest extension version still compatible with specified schema version?
    // pluginVersion = _datasetInfo.type.version;
    pluginVersion = undefined;

  } catch (e) {
    console.error("Failed to get extension ID or load extension manager", e);
    throw e;
  }

  const pluginName = pluginID; // TODO: DRY


  // if (!pluginPath) {
  //   log.error("Repository view: Cannot get plugin path");
  //   throw new Error("Cannot get extension module file path");
  // }
  // Require plugin
  try {
    // Experiment with using plain remote did not work so well so far.
    //const pluginPromise: RendererPlugin = global.require(path.resolve(`${pluginPath}/plugin`)).default;
    console.debug("Dataset view: Awaiting renderer plugin…", pluginName, pluginVersion);

    // IMPORTANT: VS Code may report await as unnecessary, but it is very much required.
    // Could be due to broken typings in live-plugin-manager.
    console.time("Dataset view: Awaiting renderer plugin…");
    const plugin = await getPlugin(pluginName, pluginVersion);
    console.timeEnd("Dataset view: Awaiting renderer plugin…");

    if (!plugin.mainView) {
      console.error("Dataset view: Not provided by plugin", pluginName, pluginVersion, plugin.mainView);
      throw new Error("Error requesting main dataset view from Paneron extension");
    }

    MainView = plugin.mainView;
    getObjectView = plugin.getObjectView;
    console.debug("Dataset view: Got renderer plugin and dataset view", plugin);

    console.time("Dataset view: Loading dataset…");
    const dataset = (await loadDataset.renderer!.trigger({
      workingCopyPath,
      datasetID,
    })).result;
    console.timeEnd("Dataset view: Loading dataset…");

    if (!dataset || !dataset.success) {
      throw new Error("Unable to load dataset");
    }

  } catch (e) {
    console.error("Dataset view: Error requiring plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw e;
  }

  return { MainView, writeAccess, dataset, getObjectView };
}
