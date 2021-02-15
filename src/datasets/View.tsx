/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import { remote } from 'electron';
import React, { useState } from 'react';
import { PluginManager } from 'live-plugin-manager';
import {
  Button, ButtonGroup,
  Callout,
  Classes, Colors,
  Navbar,
  NonIdealState,
  UL,
} from '@blueprintjs/core';
import {
  ObjectsChangedEventHook,
  RendererPlugin,
  ObjectDataHook, ObjectPathsHook, ObjectSyncStatusHook,
  DatasetContext,
} from '@riboseinc/paneron-extension-kit/types';

import { WindowComponentProps } from 'window';
import { makeRandomUUID, chooseFileFromFilesystem } from 'common';
import {
  commitChanges,
  listAllObjectPathsWithSyncStatus,
  listObjectPaths, readContents,
  repositoryContentsChanged,
  repositoryStatusChanged,
} from 'repositories';
import { ErrorBoundary } from 'renderer/widgets';
import { getPluginInfo, getPluginManagerProps, installPlugin } from 'plugins';
import {
  getDatasetInfo,
  makeChangesetRepoRelative,
  makeDataRequestRepoRelative,
  makeDatasetDatasetRelative,
  makeObjectPathDatasetRelative,
  makeObjectStatusSetDatasetRelative,
} from 'datasets';
import { DatasetInfo } from 'datasets/types';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const PLUGINS_PATH = path.join(remote.app.getPath('userData'), 'plugins');


const query = new URLSearchParams(window.location.search);
const workingCopyPath = (query.get('workingCopyPath') || '').trim();
const datasetPath = (query.get('datasetPath') || '').trim() || undefined;


const useObjectsChanged: ObjectsChangedEventHook = (eventCallback, args) => {
  return repositoryContentsChanged.renderer!.useEvent(async (evt) => {
    if (evt.workingCopyPath === workingCopyPath) {
      log.silly("Dataset view: got objects changed event", Object.keys(evt.objects || {}));
      // TODO: Make dataset relative
      eventCallback({ objects: evt.objects });
    }
  }, args);
};

const useObjectPaths: ObjectPathsHook = (datasetQuery) => {
  if (!datasetPath) {
    throw new Error("useObjectData: Dataset path is required");
  }

  // Make requested path prefix dataset-relative (prepend dataset path)
  const query = {
    ...datasetQuery,
    pathPrefix: datasetPath
      ? path.join(datasetPath, datasetQuery.pathPrefix)
      : datasetPath,
  };

  //log.silly("Dataset view: using objects path", query);

  const result = listObjectPaths.renderer!.useValue({
    workingCopyPath,
    query,
  }, []);

  useObjectsChanged(async (evt) => {
    if (evt.objects === undefined) {
      result.refresh();
    } else {
      const paths = Object.keys(evt.objects);
      if (paths.find(p => p.startsWith(query.pathPrefix))) {
        result.refresh();
      }
    }
  }, [JSON.stringify(query)]);

  return {
    ...result,
    // Make each detected path relative to dataset (un-prepend dataset path)
    value: result.value.map(path => makeObjectPathDatasetRelative(path, datasetPath)),
  };
};

const useObjectSyncStatus: ObjectSyncStatusHook = () => {
  if (!datasetPath) {
    throw new Error("useObjectSyncStatus: Dataset path is required");
  }

  const result = listAllObjectPathsWithSyncStatus.renderer!.useValue({
    workingCopyPath,
  }, {});

  //log.silly("Dataset view: using object sync status", Object.keys(result.value));

  useObjectsChanged(async (evt) => {
    result.refresh();
  }, []);

  repositoryStatusChanged.renderer!.useEvent(async (evt) => {
    if (workingCopyPath === evt.workingCopyPath) {
      if (evt.status.status === 'ready') {
        result.refresh();
      }
    }
  }, []);

  return {
    ...result,
    value: makeObjectStatusSetDatasetRelative(result.value, datasetPath),
  };
};

const useObjectData: ObjectDataHook = (datasetDataRequest) => {
  if (!datasetPath) {
    throw new Error("useObjectData: Dataset path is required");
  }

  const repoDataRequest = makeDataRequestRepoRelative(datasetDataRequest, datasetPath);

  const result = readContents.renderer!.useValue({
    workingCopyPath,
    objects: repoDataRequest,
  }, {});

  //log.silly("Dataset view: Using object data", Object.keys(repoDataRequest), result.value);

  useObjectsChanged(async (evt) => {
    result.refresh();
  }, [Object.keys(repoDataRequest).length]);

  return {
    ...result,
    value: makeDatasetDatasetRelative(result.value, datasetPath),
  };
};

//const useRepositoryInfo = () => {
//  return getRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: { workingCopyPath } });
//}

//const useRemoteUsername: RemoteUsernameHook = () => {
//  const repoCfg = useRepositoryInfo();
//  return {
//    ...repoCfg,
//    value: { username: repoCfg.value.info?.remote?.username || undefined },
//  }
//};
//
//const useAuthorEmail: AuthorEmailHook = () => {
//  const repoCfg = useRepositoryInfo();
//
//  if (!repoCfg.value.info.author?.email) {
//    throw new Error("Misconfigured repository: missing author email");
//  }
//
//  return {
//    ...repoCfg,
//    value: { email: repoCfg.value.info.author?.email },
//  }
//};

const requestFileFromFilesystem: DatasetContext["requestFileFromFilesystem"] = async (props) => {
  const result = await chooseFileFromFilesystem.renderer!.trigger(props);
  if (result.result) {
    return result.result;
  } else {
    log.error("Unable to request file from filesystem", result.errors);
    throw new Error("Unable to request file from filesystem");
  }
}

const _makeRandomID: DatasetContext["makeRandomID"] = async () => {
  const id = (await makeRandomUUID.renderer!.trigger({})).result?.uuid;
  if (!id) {
    throw new Error("Unable to obtain a random ID")
  }
  return id;
}

const changeObjects: DatasetContext["changeObjects"] = async (changeset, commitMessage, ignoreConflicts) => {
  if (!datasetPath) {
    throw new Error("changeObjects: Dataset path is required");
  }

  const result = (await commitChanges.renderer!.trigger({
    workingCopyPath,
    changeset: makeChangesetRepoRelative(changeset, datasetPath),
    commitMessage,
    ignoreConflicts: ignoreConflicts || undefined,
  }));
  if (result.result) {
    return result.result;
  } else {
    log.error("Unable to change objects", result.errors)
    throw new Error("Unable to change objects");
  }
}


const repoView: Promise<React.FC<WindowComponentProps>> = new Promise((resolve, reject) => {

  getDataset(workingCopyPath, datasetPath).then(({ dataset, MainView }) => {

    const Details: React.FC<Record<never, never>> = function () {
      const datasetContext: DatasetContext = {
        title: dataset.title,
        useObjectsChangedEvent: useObjectsChanged,
        useObjectPaths,
        useObjectSyncStatus,
        useObjectData,

        //useRemoteUsername,
        //useAuthorEmail,

        getRuntimeNodeModulePath: moduleName =>
          path.join(NODE_MODULES_PATH, moduleName),

        makeAbsolutePath: relativeDatasetPath =>
          path.join(workingCopyPath, datasetPath || '', relativeDatasetPath),

        requestFileFromFilesystem,
        makeRandomID: _makeRandomID,
        changeObjects,
      };
      const [datasetSettingsState, toggleDatasetSettingsState] = useState(false);

      return (
        <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}>
          <div
              className={Classes.ELEVATION_2}
              css={css`
                flex: 1; z-index: 2; display: flex; flex-flow: column nowrap; overflow: hidden;
                background: ${Colors.LIGHT_GRAY5};
              `}>
            <ErrorBoundary viewName="dataset">
              <MainView
                css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}
                {...datasetContext}
              />
            </ErrorBoundary>
          </div>

          <Toolbar
            dataset={dataset}
            datasetSettingsOpen={datasetSettingsState}
            onToggleDatasetSettings={() => toggleDatasetSettingsState(s => !s)} />
        </div>
      );

    }

    resolve(Details);

  }).catch((err) => resolve(() =>
    <NonIdealState
      icon="heart-broken"
      title="Error loading extension"
      css={css`background: ${Colors.LIGHT_GRAY5}`}
      description={<>
        <Callout style={{ textAlign: 'left' }} title="Suggestions to resolve" intent="primary">
          <p>Make sure Paneron can connect to internet, and try the following:</p>
          <UL>
            <li>Check that you have the extension for this dataset installed: you should
              see <Button disabled intent="success" small icon="tick-circle">Installed</Button> in dataset details pane.</li>
            <li>Downloading the latest version of Paneron, and upgrading the extension as well.</li>
          </UL>
        </Callout>
        <Callout title="Error details" style={{ transform: 'scale(0.8)', textAlign: 'left' }}>
          {err.message}
        </Callout>
      </>}
    />
  ));

});


async function getDataset(workingCopyPath: string, datasetPath?: string):
Promise<{ dataset: DatasetInfo, MainView: React.FC<DatasetContext> }> {

  if (workingCopyPath === '') {
    throw new Error("Invalid repository working copy path");
  }

  let MainView: React.FC<DatasetContext>;
  let dataset: DatasetInfo;

  let pluginManager: PluginManager;
  let pluginID: string;
  let pluginVersion: string;

  // Prepare plugin info and manager
  try {
    const [datasetInfo, pluginManagerProps] = await Promise.all([
      getDatasetInfo.renderer!.trigger({ workingCopyPath, datasetPath }),
      getPluginManagerProps.renderer!.trigger({}),
    ]);

    const _datasetInfo = datasetInfo.result?.info;

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
    log.silly("Dataset view: Got renderer plugin and dataset view", plugin);

  } catch (e) {
    log.error("Dataset view: Error requiring plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw e;
  }

  return { MainView, dataset };
}


export default repoView;


interface ToolbarProps {
  dataset: DatasetInfo

  datasetSettingsOpen: boolean
  onToggleDatasetSettings?: () => void
}

const Toolbar: React.FC<ToolbarProps> =
function ({ dataset, datasetSettingsOpen, onToggleDatasetSettings }) {
  const pluginInfo = getPluginInfo.renderer!.useValue({
    id: dataset.type.id || '',
  }, { plugin: null });

  return (
    <Navbar css={css`background: ${Colors.LIGHT_GRAY2}; height: 35px;`}>
      <Navbar.Group css={css`height: 35px`}>
        <ButtonGroup minimal>
          <Button icon="database" rightIcon="caret-up">
            {dataset.title}
            {" "}
            {pluginInfo.value.plugin
              ? <>— {pluginInfo.value.plugin.title} v{pluginInfo.value.plugin.npm.version}</>
              : null}
          </Button>
          <Button
            icon="settings"
            disabled={!onToggleDatasetSettings}
            onClick={onToggleDatasetSettings}
            active={datasetSettingsOpen} />
        </ButtonGroup>
      </Navbar.Group>
    </Navbar>
  );
};


// const InitialView = () => <NonIdealState title={<Spinner />} />;
// const InvalidView = () => <NonIdealState title="Invalid plugin" />;


//const DatasetSettings: React.FC<Record<never, never>> = function () {
//  return <p>Dataset settings</p>
//}
