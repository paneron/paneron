/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import React, { useEffect, useState } from 'react';
import { PluginManager } from 'live-plugin-manager';
import { NonIdealState, Spinner } from '@blueprintjs/core';
import { getStructuredRepositoryInfo } from 'repositories';
import { WindowComponentProps } from 'window';
import { getPluginInfo, getPluginManagerProps } from 'plugins';


interface PluginViewProps {
  title: string
  readContents: () => void
  commitChanges: () => void
}

interface RendererPlugin {
  repositoryView?: Promise<React.FC<PluginViewProps>>,
}

const RepositoryDetails: React.FC<WindowComponentProps> = function ({ query }) {
  const workingCopyPath = (query.get('workingCopyPath') || '').trim();

  const repo = getStructuredRepositoryInfo.renderer!.useValue({ workingCopyPath }, { info: null });
  const pluginManagerProps = getPluginManagerProps.renderer!.useValue({}, {}).value;
  const [repositoryView, setRepositoryView] = useState<React.FC<PluginViewProps> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const pluginID = repo.value.info?.pluginID;

  log.debug("Rendering repository window", pluginManagerProps, pluginID);

  useEffect(() => {
    (async () => {
      if (pluginID && pluginManagerProps.cwd && pluginManagerProps.pluginsPath && !loaded) {
        try {
          const manager = new PluginManager(pluginManagerProps);
          const pluginInfo = await getPluginInfo.renderer!.trigger({ id: pluginID });
          const version = pluginInfo.result?.installedVersion;

          log.debug("Opening repository window", pluginID, pluginManagerProps);

          if (version) {
            const pluginName = `@riboseinc/plugin-${pluginID}`; // TODO: DRY
            await manager.install(pluginName, version);
            const plugin: RendererPlugin = manager.require(pluginName).default;

            if (plugin.repositoryView) {
              const view = await plugin.repositoryView;
              setRepositoryView(() => view);
            }
          }
        } catch (e) {
          log.error("Repositories: Failed to load repository view from plugin", pluginID);
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

  if (!loaded || repo.isUpdating || !pluginManagerProps.cwd || !pluginManagerProps.pluginsPath) {
    return <NonIdealState title={<Spinner />} />;
  }

  if (repositoryView === null) {
    return <NonIdealState title="Invalid plugin" />;
  }

  const View = repositoryView;

  return (
    <div css={css`flex: 1; display: flex; flex-flow: column nowrap;`}>
      <p>{repo.value.info.title}</p>
      <View
        css={css`flex: 1; display: flex; flex-flow: column nowrap`}
        title={repo.value.info.title}
        readContents={() => void 0}
        commitChanges={() => void 0} />
    </div>
  );
};


export default RepositoryDetails;
