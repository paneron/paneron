/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx, css } from '@emotion/react';
import { Classes, Spinner, Icon, IconSize } from '@blueprintjs/core';
import { MenuItem2 as MenuItem } from '@blueprintjs/popover2';
import { getDatasetInfo } from 'datasets/ipc';
import { getPluginInfo, pluginsUpdated } from 'plugins';
import { describeRepository } from 'repositories/ipc';
import RepoLabel from './RepoLabel';


const DatasetMenuItem: React.FC<{
  workDir: string;
  datasetID: string;
  showRepoInfo?: true;
  onExportClick?: () => void;
  onClick?: () => void;
}> =
function ({ workDir, datasetID, showRepoInfo, onClick, onExportClick }) {
  const { isUpdating: datasetInfoIsUpdating, value: { info: dsInfo } } =
  getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetID },
    { info: null });

  const datasetType = dsInfo?.type.id ?? '';

  const { isUpdating: pluginInfoIsUpdating, refresh, value: { plugin: pluginInfo } } =
  getPluginInfo.renderer!.useValue(
    { id: datasetType },
    { plugin: null });
  pluginsUpdated.renderer!.useEvent(refresh, [datasetType]);

  const effectiveIconEl: JSX.Element = (pluginInfoIsUpdating || datasetInfoIsUpdating)
    ? <Spinner
        size={IconSize.STANDARD}
        className={Classes.ICON}
        css={css`display: inline-flex;`}
        title="Loading extension information"
      />
    : pluginInfo !== null
      ? pluginInfo.iconURL
        ? <Icon
            icon={<img className={Classes.ICON}
              css={css`height: ${IconSize.STANDARD}px; width: ${IconSize.STANDARD}px`}
              src={pluginInfo?.iconURL} />}
          />
        : <Icon icon="cube" title="Extension does not have an icon specified" />
      : <Icon icon="offline" title="Unable to fetch extension information" />;

  return (
    <MenuItem
        icon="database"
        intent="primary"
        disabled={!dsInfo || !pluginInfo || !onClick}
        labelElement={<>{pluginInfo?.title}&nbsp;{effectiveIconEl}</>}
        popoverProps={{
          placement: 'bottom-end',
        }}
        text={<>
          {showRepoInfo
            ? <small css={css`font-variation-settings: 'GRAD' 500, 'opsz' 20;`}><RepositoryTitle workDir={workDir} />: </small>
            : null}
          {dsInfo?.title ?? datasetID}
        </>}
        title={dsInfo?.title ?? datasetID}
        onClick={onClick}>
      {onExportClick
        ? <MenuItem icon="export" text="Export options…" onClick={onExportClick} />
        : null}
    </MenuItem>
  );
};


const RepositoryTitle: React.FC<{ workDir: string }> = function ({ workDir }) {
  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } }, isLoaded: false });

  const repo = openedRepoResp.value.info;

  return <RepoLabel repo={repo} />;
}


export default DatasetMenuItem;
