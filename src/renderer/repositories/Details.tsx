/** @jsx jsx */
/** @jsxFrag React.Fragment */

import ReactDOM from 'react-dom';

import path from 'path';
import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import React from 'react';
import { PluginManager } from 'live-plugin-manager';
import { Classes, Colors, Navbar, /*NonIdealState, Spinner,*/ Tag } from '@blueprintjs/core';
import {
  commitChanges,
  getRepositoryInfo,
  getStructuredRepositoryInfo,
  listAllObjectPathsWithSyncStatus,
  listObjectPaths, makeRandomID, readContents,
  repositoryContentsChanged,
  repositoryStatusChanged,
  StructuredRepoInfo
} from 'repositories';
import {
  ObjectsChangedEventHook,
  RendererPlugin, RepositoryViewProps,
  ObjectDataHook, ObjectPathsHook, RemoteUsernameHook, ObjectSyncStatusHook
} from '@riboseinc/paneron-extension-kit/types';
import { getPluginInfo, getPluginManagerProps } from 'plugins';
import { WindowComponentProps } from 'window';
import { chooseFileFromFilesystem } from 'common';


const query = new URLSearchParams(window.location.search);
const workingCopyPath = (query.get('workingCopyPath') || '').trim();


const useObjectsChanged: ObjectsChangedEventHook = (eventCallback, args) => {
  return repositoryContentsChanged.renderer!.useEvent(async (evt) => {
    if (evt.workingCopyPath === workingCopyPath) {
      eventCallback({ objects: evt.objects });
    }
  }, args);
};

const useObjectPaths: ObjectPathsHook = (query) => {
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

  return result;
};

const useObjectSyncStatus: ObjectSyncStatusHook = () => {
  const result = listAllObjectPathsWithSyncStatus.renderer!.useValue({
    workingCopyPath,
  }, {});

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

  return result;
};

const useObjectData: ObjectDataHook = (objects) => {
  const result = readContents.renderer!.useValue({
    workingCopyPath,
    objects,
  }, {});

  useObjectsChanged(async (evt) => {
    result.refresh();
  }, [Object.keys(objects).length]);

  return result;
};

const useRemoteUsername: RemoteUsernameHook = () => {
  const repoCfg = getRepositoryInfo.renderer!.useValue({
    workingCopyPath,
  }, {
    info: { workingCopyPath },
  });
  return {
    ...repoCfg,
    value: { username: repoCfg.value.info?.remote?.username || undefined },
  }
};


const repoView: Promise<React.FC<WindowComponentProps>> = new Promise((resolve, reject) => {

  getRepoInfo(workingCopyPath).then(({ info, Component }) => {

    const thing = (
      <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}>
        <div
            className={Classes.ELEVATION_2}
            css={css`flex: 1; z-index: 2; display: flex; flex-flow: column nowrap; background: ${Colors.LIGHT_GRAY5}; overflow: hidden;`}>

          <Component
            css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}
            title={info.title}

            React={React}

            // TODO: remote will be obsolete. Unfortunately, calling setTimeout within dynamically resolved extension components will be an illegal invocation.
            setTimeout={require('electron').remote.getGlobal('setTimeout')}

            useObjectsChangedEvent={useObjectsChanged}
            useObjectPaths={useObjectPaths}
            useObjectSyncStatus={useObjectSyncStatus}
            useObjectData={useObjectData}
            useRemoteUsername={useRemoteUsername}

            makeAbsolutePath={relativeGitPath => path.join(workingCopyPath, relativeGitPath)}

            requestFileFromFilesystem={async (props) => {
              const result = await chooseFileFromFilesystem.renderer!.trigger(props);
              if (result.result) {
                return result.result;
              } else {
                log.error("Unable to request file from filesystem", result.errors);
                throw new Error("Unable to request file from filesystem");
              }
            }}

            makeRandomID={async () => {
              const id = (await makeRandomID.renderer!.trigger({})).result?.id;
              if (!id) {
                throw new Error("Unable to obtain a random ID")
              }
              return id;
            }}
            changeObjects={async (changeset, commitMessage, ignoreConflicts) => {
              const result = (await commitChanges.renderer!.trigger({
                workingCopyPath,
                changeset,
                commitMessage,
                ignoreConflicts: ignoreConflicts || undefined,
              }));
              if (result.result) {
                return result.result;
              } else {
                log.error("Unable to change objects", result.errors)
                throw new Error("Unable to change objects");
              }
            }}
          />

        </div>

        <Toolbar workingCopyPath={workingCopyPath} structuredRepo={info} />
      </div>
    );


    ReactDOM.render(thing, document.getElementById('app'));

    resolve(() => <></>);

  }).catch((err) => reject(err));

});


async function getRepoInfo(workingCopyPath: string):
Promise<{ info: StructuredRepoInfo, Component: React.FC<RepositoryViewProps> }> {

  if (workingCopyPath === '') {
    throw new Error("Invalid working copy path");
  }

  let pluginManager: PluginManager;
  let pluginID: string;
  let pluginVersion: string;
  let structuredRepoInfo: StructuredRepoInfo;

  // Prepare plugin info and manager
  try {
    const [structuredRepo, pluginManagerProps] = await Promise.all([
      getStructuredRepositoryInfo.renderer!.trigger({ workingCopyPath }),
      getPluginManagerProps.renderer!.trigger({}),
    ]);

    const _structuredRepoInfo = structuredRepo.result?.info;

    if (!_structuredRepoInfo) {
      throw new Error("Missing structured repository info");
    }

    const _pluginID = _structuredRepoInfo.pluginID;
    const cwd = pluginManagerProps.result?.cwd;
    const pluginsPath = pluginManagerProps.result?.pluginsPath;

    if (!_pluginID) {
      throw new Error("Plugin ID is missing in structured repository info");
    }
    if (!pluginsPath || !cwd) {
      throw new Error("Plugin manager props are missing");
    }

    structuredRepoInfo = _structuredRepoInfo;
    pluginManager = new PluginManager({ cwd, pluginsPath });
    pluginID = _pluginID;

  } catch (e) {
    throw new Error("Failed to get plugin ID or plugin manager props");
  }

  // Check plugin’s installed version
  try {
    const pluginInfo = await getPluginInfo.renderer!.trigger({ id: pluginID });
    const _version = pluginInfo.result?.installedVersion;

    if (!_version) {
      log.error("Repository view: Plugin is not installed?", workingCopyPath, pluginID, pluginInfo);
      throw new Error("Plugin is not installed");
    }

    pluginVersion = _version;

  } catch (e) {
    log.error("Repository view: Failed to get plugin info for plugin", workingCopyPath, pluginID, e);
    throw new Error("Failed to get plugin info for plugin");
  }

  const pluginName = `@riboseinc/paneron-extension-${pluginID}`; // TODO: DRY

  // Install plugin in renderer
  try {
    if (process.env.PANERON_PLUGIN_DIR === undefined) {
      log.silly("Repository view: Installing plugin for renderer...", workingCopyPath, pluginName, pluginVersion);
      await pluginManager.installFromNpm(pluginName, pluginVersion);
    } else {
      log.silly("Repository view: (DEV) Installing plugin for renderer...", path.join(process.env.PANERON_PLUGIN_DIR, pluginName));
      await pluginManager.installFromPath(path.join(process.env.PANERON_PLUGIN_DIR, pluginName));
    }

  } catch (e) {
    log.error("Repository view: Error installing plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw new Error("Error initializing plugin");
  }

  // Require plugin

  let RepoView: React.FC<RepositoryViewProps>;

  try {
    log.silly("Repositories: Requiring renderer plugin...", pluginName);
    const pluginPromise: RendererPlugin = pluginManager.require(pluginName).default;
    log.silly("Repositories: Awaiting renderer plugin...", pluginPromise);
    const plugin = await pluginPromise;
    log.silly("Repositories: Got renderer plugin", plugin);

    if (!plugin.repositoryView) {
      log.error("Repository view: Not provided by plugin", pluginName, pluginVersion);
      throw new Error("Plugin does not provide repository view");
    }

    RepoView = plugin.repositoryView;

  } catch (e) {
    log.error("Repository view: Error requiring plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw new Error("Error requiring plugin");
  }

  return { Component: RepoView, info: structuredRepoInfo };
}


export default repoView;


// const InitialView = () => <NonIdealState title={<Spinner />} />;
// const InvalidView = () => <NonIdealState title="Invalid plugin" />;


const Toolbar: React.FC<{ workingCopyPath: string, structuredRepo: StructuredRepoInfo }> =
function ({ workingCopyPath, structuredRepo }) {
  return (
    <Navbar css={css`background: ${Colors.LIGHT_GRAY2}; height: 35px;`}>
      <Navbar.Group css={css`height: 35px`}>
        <Tag icon="git-repo" minimal round large>{structuredRepo.title}</Tag>
      </Navbar.Group>
    </Navbar>
  );
};
