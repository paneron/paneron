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
  RendererPlugin,
  DatasetContext,
  IndexedObjectPathsHook,
  IndexedObjectDataHook,
  RawObjectsChangedEventHook,
  RawObjectPathsHook,
  RawObjectSyncStatusHook,
  RawObjectDataHook,
} from '@riboseinc/paneron-extension-kit/types';

import { WindowComponentProps } from 'window';
import { makeRandomID, chooseFileFromFilesystem } from 'common';
import { ErrorBoundary } from 'renderer/widgets';
import { DatasetInfo } from 'datasets/types';

// IPC endpoints
import {
  getPluginInfo,
  getPluginManagerProps,
  installPlugin,
} from 'plugins';
import {
  getDatasetInfo,
  loadDataset,
  makeChangesetRepoRelative,
  makeDataRequestRepoRelative,
  makeDatasetDatasetRelative,
  makeObjectPathDatasetRelative,
  makeObjectStatusSetDatasetRelative,
  listObjectPaths,
  readObjects,
} from 'datasets';
import {
  commitChanges,
  listAllObjectPathsWithSyncStatus,
  listObjectPaths as listRawObjectPaths,
  readContents,
  repositoryContentsChanged,
  repositoryStatusChanged,
} from 'repositories';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const PLUGINS_PATH = path.join(remote.app.getPath('userData'), 'plugins');


const query = new URLSearchParams(window.location.search);
const workingCopyPath = (query.get('workingCopyPath') || '').trim();
const datasetPath = (query.get('datasetPath') || '').trim() || undefined;

if (!datasetPath) {
  throw new Error("Missing dataset path");
}

//repositoryContentsChanged.renderer!.handle(async (evt) => {
//  if (workingCopyPath === evt.workingCopyPath) {
//    for (const objPath of Object.keys(evt.objects || {})) {
//      delete _index[makeObjectPathDatasetRelative(objPath, datasetPath)];
//    }
//  }
//});


// Hooks


const useObjectData: IndexedObjectDataHook = (dataRequest) => {
  const result = readObjects.renderer!.useValue({
    workingCopyPath,
    datasetPath,
    objectPaths: Object.keys(dataRequest),
  }, { data: {} });

  return result;
};


const useObjectPaths: IndexedObjectPathsHook = () => {
  const result = listObjectPaths.renderer!.useValue({
    workingCopyPath,
    datasetPath,
  }, { objectPaths: [] });

  return result;
};


const useRawObjectsChangedEvent: RawObjectsChangedEventHook = (eventCallback, args) => {
  return repositoryContentsChanged.renderer!.useEvent(async (evt) => {
    if (evt.workingCopyPath === workingCopyPath) {
      log.silly("Dataset view: got objects changed event", Object.keys(evt.objects || {}));
      // TODO: Make dataset relative
      eventCallback({ objects: evt.objects });
    }
  }, args);
};

const useRawObjectPaths: RawObjectPathsHook = (datasetQuery) => {
  // Make requested path prefix dataset-relative (prepend dataset path)
  const query = {
    ...datasetQuery,
    pathPrefix: datasetPath
      ? path.join(datasetPath, datasetQuery.pathPrefix)
      : datasetPath,
  };

  //log.silly("Dataset view: using objects path", query);

  const result = listRawObjectPaths.renderer!.useValue({
    workingCopyPath,
    query,
  }, []);

  useRawObjectsChangedEvent(async (evt) => {
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

const useRawObjectSyncStatus: RawObjectSyncStatusHook = () => {
  const result = listAllObjectPathsWithSyncStatus.renderer!.useValue({
    workingCopyPath,
  }, {});

  //log.silly("Dataset view: using object sync status", Object.keys(result.value));

  useRawObjectsChangedEvent(async (evt) => {
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

const useRawObjectData: RawObjectDataHook = (datasetDataRequest) => {
  const repoDataRequest = makeDataRequestRepoRelative(datasetDataRequest, datasetPath);

  const result = readContents.renderer!.useValue({
    workingCopyPath,
    objects: repoDataRequest,
  }, {});

  //log.silly("Dataset view: Using object data", Object.keys(repoDataRequest), result.value);

  useRawObjectsChangedEvent(async (evt) => {
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
  const id = (await makeRandomID.renderer!.trigger({})).result?.id;
  if (!id) {
    throw new Error("Unable to obtain a random ID")
  }
  return id;
}

const changeObjects: DatasetContext["changeObjects"] = async (changeset, commitMessage, ignoreConflicts) => {
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

  getDataset(workingCopyPath, datasetPath).then(({ dataset, MainView, getObjectView }) => {

    const Details: React.FC<Record<never, never>> = function () {
      const datasetContext: DatasetContext = {
        title: dataset.title,

        useObjectData,
        useObjectPaths,

        useRawObjectsChangedEvent,
        useRawObjectPaths,
        useRawObjectSyncStatus,
        useRawObjectData,

        getObjectView,

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
Promise<{
  dataset: DatasetInfo
  MainView: React.FC<DatasetContext>
  getObjectView: RendererPlugin["getObjectView"]
}> {

  if (workingCopyPath === '') {
    throw new Error("Invalid repository working copy path");
  }

  let MainView: React.FC<DatasetContext>;
  let dataset: DatasetInfo;
  let getObjectView: RendererPlugin["getObjectView"];

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

  return { MainView, dataset, getObjectView };
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
