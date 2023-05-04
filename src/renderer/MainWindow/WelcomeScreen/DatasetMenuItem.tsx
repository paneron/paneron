/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx, css } from '@emotion/react';
import { Classes, Icon, IconSize } from '@blueprintjs/core';
import { MenuItem2 as MenuItem } from '@blueprintjs/popover2';
import { getDatasetInfo } from 'datasets/ipc';
import { getPluginInfo } from 'plugins';
import { describeRepository } from 'repositories/ipc';


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
  const { isUpdating: pluginInfoIsUpdating, value: { plugin: pluginInfo } } =
  getPluginInfo.renderer!.useValue(
    { id: dsInfo?.type.id ?? '' },
    { plugin: null });

  const effectiveIconEl: JSX.Element = (pluginInfoIsUpdating || datasetInfoIsUpdating)
    ? <Icon icon="circle" />
    : !pluginInfo?.iconURL
      ? <Icon icon="heart-broken" />
      : <Icon
          icon={<img className={Classes.ICON}
            css={css`height: ${IconSize.STANDARD}px; width: ${IconSize.STANDARD}px`}
            src={pluginInfo?.iconURL} />}
        />;

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

  return <>
    {repo.paneronMeta?.title ?? '(no repository title)'}
  </>;
}


export default DatasetMenuItem;
