/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import React, { useEffect, useState } from 'react';
import { PluginManager } from 'live-plugin-manager';
import { Classes, Navbar, NonIdealState, Spinner, Tag } from '@blueprintjs/core';
import { getStructuredRepositoryInfo, repositoryContentsChanged, StructuredRepoInfo } from 'repositories';
import { RendererPlugin, RepositoryViewProps } from '@riboseinc/paneron-plugin-kit/types';
import { WindowComponentProps } from 'window';
import { getPluginInfo, getPluginManagerProps } from 'plugins';


const RepositoryDetails: React.FC<WindowComponentProps> = function ({ query }) {
  const workingCopyPath = (query.get('workingCopyPath') || '').trim();

  const repo = getStructuredRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: null });
  const pluginManagerProps = getPluginManagerProps.renderer!.useValue({}, {}).value;
  const [repositoryView, setRepositoryView] = useState<React.FC<RepositoryViewProps> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const pluginID = repo.value.info?.pluginID;

  useEffect(() => {
    (async () => {
      if (pluginID && pluginManagerProps.cwd && pluginManagerProps.pluginsPath && !loaded) {
        try {
          log.silly("Loading manager...");

          const manager = new PluginManager(pluginManagerProps);

          log.silly("Loading plugin info...");

          const pluginInfo = await getPluginInfo.renderer!.trigger({ id: pluginID });
          const version = pluginInfo.result?.installedVersion;

          if (version) {
            const pluginName = `@riboseinc/plugin-${pluginID}`; // TODO: DRY
            if (process.env.PANERON_PLUGIN_DIR === undefined) {
              log.silly("Installing plugin for renderer...", pluginName, version);
              await manager.installFromNpm(pluginName, version);
            } else {
              log.silly("Repositories: Installing plugin for renderer...", path.join(process.env.PANERON_PLUGIN_DIR, pluginName));
              await manager.installFromPath(path.join(process.env.PANERON_PLUGIN_DIR, pluginName));
            }
            log.silly("Repositories: Requiring plugin...", pluginName);
            const pluginPromise: RendererPlugin = manager.require(pluginName).default;
            log.silly("Repositories: Awaiting plugin...", pluginPromise);
            const plugin = await pluginPromise;
            log.silly("Repositories: Got plugin", plugin);

            if (plugin.repositoryView) {
              log.silly("Loading repository view...", plugin.repositoryView, pluginName, version);
              const view = plugin.repositoryView;
              log.silly("Loaded repository view.", pluginName, version);
              setImmediate(() => setRepositoryView(() => view));
            } else {
              log.warn("No repository view defined by the plugin!", plugin);
            }
          }
        } catch (e) {
          log.error("Repositories: Failed to load repository view from plugin", pluginID, e);
          throw e;
        } finally {
          setLoaded(true);
        }
      }
    })();
  }, [pluginID, pluginManagerProps]);

  if (workingCopyPath === '') {
    return <NonIdealState title="Repository not found" />;
  }
  if (!repo.value.info) {
    return <NonIdealState title="Invalid structured repository" />;
  }

  let el: JSX.Element;
  if (!loaded || repo.isUpdating || !pluginManagerProps.cwd || !pluginManagerProps.pluginsPath) {
    el = <NonIdealState title={<Spinner />} />;
  } else if (repositoryView === null) {
    el = <NonIdealState title="Invalid plugin" />;
  } else {
    const View = repositoryView;
    el = <View
      css={css`flex: 1; display: flex; flex-flow: column nowrap`}
      title={repo.value.info.title}
      useRepoContentsChanged={repositoryContentsChanged.renderer!.useEvent}
      readObjects={async () => ({})}
      changeObjects={async () => ({ success: true })} />;
  }


  return (
    <div css={css`flex: 1; display: flex; flex-flow: column nowrap;`}>
      <div className={Classes.ELEVATION_2} css={css`flex: 1; display: flex; flex-flow: column nowrap; z-index: 2`}>
        {el}
      </div>
      <Toolbar workingCopyPath={workingCopyPath} structuredRepo={repo.value.info} />
    </div>
  );
};


export default RepositoryDetails;


const Toolbar: React.FC<{ workingCopyPath: string, structuredRepo: StructuredRepoInfo }> =
function ({ workingCopyPath, structuredRepo }) {
  return (
    <Navbar>
      <Navbar.Group>
        <Tag icon="git-repo" large minimal>{structuredRepo.title}</Tag>
      </Navbar.Group>
    </Navbar>
  );
};
