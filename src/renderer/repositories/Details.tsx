/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import { remote } from 'electron';
import React from 'react';
import { PluginManager } from 'live-plugin-manager';
import { Button, Callout, Classes, Colors, Navbar, NonIdealState, /*NonIdealState, Spinner,*/ Tag, UL } from '@blueprintjs/core';
import {
  commitChanges,
  getRepositoryInfo,
  getStructuredRepositoryInfo,
  listAllObjectPathsWithSyncStatus,
  listObjectPaths, readContents,
  repositoryContentsChanged,
  repositoryStatusChanged,
  StructuredRepoInfo
} from 'repositories';
import {
  ObjectsChangedEventHook,
  RendererPlugin, ExtensionContext,
  ObjectDataHook, ObjectPathsHook, RemoteUsernameHook, ObjectSyncStatusHook, AuthorEmailHook
} from '@riboseinc/paneron-extension-kit/types';
import { getPluginInfo, getPluginManagerProps, installPlugin } from 'plugins';
import { WindowComponentProps } from 'window';
import { makeRandomID, chooseFileFromFilesystem } from 'common';


const NODE_MODULES_PATH = process.env.NODE_ENV === 'production'
  ? `${__static}/../../app.asar.unpacked/node_modules`
  : `${__static}/../../node_modules`;

const PLUGINS_PATH = path.join(remote.app.getPath('userData'), 'plugins');


const query = new URLSearchParams(window.location.search);
const workingCopyPath = (query.get('workingCopyPath') || '').trim();


class ErrorBoundary extends React.Component<Record<never, never>, { error?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { error: undefined };
  }
  componentDidCatch(error: Error, info: any) {
    log.error("Error rendering repository view", error, info);
    this.setState({ error: `${error.name}: ${error.message}` });
  }
  render() {
    log.debug("Rendering error boundary")
    if (this.state.error !== undefined) {
      return <NonIdealState
        icon="heart-broken"
        title="Ouch"
        description={
          <>
            <p>
              Error displaying repository.
            </p>
            <Callout style={{ textAlign: 'left', transform: 'scale(0.9)' }} title="Technical details">
              <pre style={{ overflow: 'auto', paddingBottom: '1em' }}>
                {this.state.error}
              </pre>
            </Callout>
          </>
        }
      />;
    }
    return this.props.children;
  }
}


const useObjectsChanged: ObjectsChangedEventHook = (eventCallback, args) => {
  return repositoryContentsChanged.renderer!.useEvent(async (evt) => {
    if (evt.workingCopyPath === workingCopyPath) {
      eventCallback({ objects: evt.objects });
    }
  }, args);
};

const useObjectPaths: ObjectPathsHook = (query) => {
  console.debug("Using object paths", query)
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

const useRepositoryInfo = () => {
  return getRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: { workingCopyPath } });
}

const useRemoteUsername: RemoteUsernameHook = () => {
  const repoCfg = useRepositoryInfo();
  return {
    ...repoCfg,
    value: { username: repoCfg.value.info?.remote?.username || undefined },
  }
};

const useAuthorEmail: AuthorEmailHook = () => {
  const repoCfg = useRepositoryInfo();

  if (!repoCfg.value.info.author?.email) {
    throw new Error("Misconfigured repository: missing author email");
  }

  return {
    ...repoCfg,
    value: { email: repoCfg.value.info.author?.email },
  }
};

const requestFileFromFilesystem: ExtensionContext["requestFileFromFilesystem"] = async (props) => {
  const result = await chooseFileFromFilesystem.renderer!.trigger(props);
  if (result.result) {
    return result.result;
  } else {
    log.error("Unable to request file from filesystem", result.errors);
    throw new Error("Unable to request file from filesystem");
  }
}

const _makeRandomID: ExtensionContext["makeRandomID"] = async () => {
  const id = (await makeRandomID.renderer!.trigger({})).result?.id;
  if (!id) {
    throw new Error("Unable to obtain a random ID")
  }
  return id;
}

const changeObjects: ExtensionContext["changeObjects"] = async (changeset, commitMessage, ignoreConflicts) => {
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
}


const repoView: Promise<React.FC<WindowComponentProps>> = new Promise((resolve, reject) => {

  getRepoInfo(workingCopyPath).then(({ info, Component }) => {
    const extensionContext: ExtensionContext = {
      title: info.title,
      useObjectsChangedEvent: useObjectsChanged,
      useObjectPaths,
      useObjectSyncStatus,
      useObjectData,
      useRemoteUsername,
      useAuthorEmail,

      getRuntimeNodeModulePath: moduleName => path.join(NODE_MODULES_PATH, moduleName),
      makeAbsolutePath: relativeGitPath => path.join(workingCopyPath, relativeGitPath),

      requestFileFromFilesystem,
      makeRandomID: _makeRandomID,
      changeObjects,
    };

    const thing = (
      <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}>
        <div
            className={Classes.ELEVATION_2}
            css={css`flex: 1; z-index: 2; display: flex; flex-flow: column nowrap; background: ${Colors.LIGHT_GRAY5}; overflow: hidden;`}>
          <ErrorBoundary>
            <Component
              css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}
              {...extensionContext}
            />
          </ErrorBoundary>
        </div>

        <Toolbar structuredRepo={info} />
      </div>
    );

    resolve(() => thing);

  }).catch((err) => resolve(() => <NonIdealState
      icon="heart-broken"
      title="Error loading extension"
      css={css`background: ${Colors.LIGHT_GRAY5}`}
      description={<>
        <Callout style={{ textAlign: 'left' }} title="Suggestions to resolve" intent="primary">
          <p>Make sure Paneron can connect to internet, and try the following:</p>
          <UL>
            <li>Check that you have the extension for this repository type installed: you should
              see <Button disabled intent="success" small icon="tick-circle">Installed</Button> in repository details pane.</li>
            <li>Downloading the latest version of Paneron, and upgrade the extension as well.</li>
          </UL>
        </Callout>
        <Callout title="Error details" style={{ transform: 'scale(0.8)', textAlign: 'left' }}>{err.message}</Callout></>} />));

});


async function getRepoInfo(workingCopyPath: string):
Promise<{ info: StructuredRepoInfo, Component: React.FC<ExtensionContext> }> {

  if (workingCopyPath === '') {
    throw new Error("Invalid repository working copy path");
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
      throw new Error("This does not seem to be a Paneron repository");
    }

    const _pluginID = _structuredRepoInfo.pluginID;
    const cwd = pluginManagerProps.result?.cwd;
    const pluginsPath = pluginManagerProps.result?.pluginsPath;

    if (!_pluginID) {
      throw new Error("Paneron repository doesn’t specify extension name");
    }
    if (!pluginsPath || !cwd) {
      throw new Error("Error configuring extension manager");
    }

    structuredRepoInfo = _structuredRepoInfo;

    pluginManager = new PluginManager({ cwd, pluginsPath });
    pluginID = _pluginID;

  } catch (e) {
    log.error("Failed to get extension ID or load extension manager", e);
    throw e;
  }

  // Check plugin’s installed version
  try {
    const pluginInfo = await getPluginInfo.renderer!.trigger({ id: pluginID });

    let _version = pluginInfo.result?.installedVersion;
    if (!_version) {
      log.warn("Repository view: Extension is not installed?", workingCopyPath, pluginID, pluginInfo);
      const installationResult = await installPlugin.renderer!.trigger({ id: pluginID });
      if (installationResult.result && installationResult.result.installed && installationResult.result.installedVersion) {
        _version = installationResult.result.installedVersion;
      } else {
        log.error("Repository view: Extension could not be installed on the fly", installationResult.errors);
        throw new Error("Required extension could not be installed");
      }
    }

    pluginVersion = _version;

  } catch (e) {
    log.error("Repository view: Failed to get extension info", pluginID, e);
    throw e;
  }

  const pluginName = `@riboseinc/paneron-extension-${pluginID}`; // TODO: DRY

  // let pluginPath: string | undefined;

  // Install plugin in renderer
  try {
    if (process.env.PANERON_DEV_PLUGIN === undefined) {
      log.silly("Repository view: Installing plugin for renderer...", workingCopyPath, pluginName, pluginVersion);
      await pluginManager.installFromNpm(pluginName, pluginVersion);
    } else {
      const pluginPath = path.join(PLUGINS_PATH, '@riboseinc', `paneron-extension-${process.env.PANERON_DEV_PLUGIN}`);
      log.silly("Repository view: (DEV) Installing plugin for renderer...", pluginPath);
      await pluginManager.installFromPath(pluginPath);
    }

    // pluginPath = pluginManager.getInfo(pluginName)?.location;

  } catch (e) {
    log.error("Repository view: Error installing plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw new Error("Error loading extension");
  }

  // if (!pluginPath) {
  //   log.error("Repository view: Cannot get plugin path");
  //   throw new Error("Cannot get extension module file path");
  // }

  // Require plugin

  let RepoView: React.FC<ExtensionContext>;

  try {
    log.silly("Repositories: Requiring renderer plugin...", pluginName);
    //const pluginPromise: RendererPlugin = global.require(path.resolve(`${pluginPath}/plugin`)).default;
    const pluginPromise: RendererPlugin = pluginManager.require(pluginName).default;
    log.silly("Repositories: Awaiting renderer plugin...", pluginPromise);
    const plugin = await pluginPromise;
    log.silly("Repositories: Got renderer plugin", plugin);

    if (!plugin.repositoryView) {
      log.error("Repository view: Not provided by plugin", pluginName, pluginVersion);
      throw new Error("Error requesting repository view from Paneron extension");
    }

    RepoView = plugin.repositoryView;

  } catch (e) {
    log.error("Repository view: Error requiring plugin", workingCopyPath, pluginName, pluginVersion, e);
    throw e;
  }

  return { Component: RepoView, info: structuredRepoInfo };
}


export default repoView;


// const InitialView = () => <NonIdealState title={<Spinner />} />;
// const InvalidView = () => <NonIdealState title="Invalid plugin" />;


const Toolbar: React.FC<{ structuredRepo: StructuredRepoInfo }> =
function ({ structuredRepo }) {
  return (
    <Navbar css={css`background: ${Colors.LIGHT_GRAY2}; height: 35px;`}>
      <Navbar.Group css={css`height: 35px`}>
        <Tag icon="git-repo" minimal round large>{structuredRepo.title}</Tag>
      </Navbar.Group>
    </Navbar>
  );
};
