/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx, css } from '@emotion/react';
import { Classes, Icon, IconSize, MenuItem } from '@blueprintjs/core';
import { getDatasetInfo } from 'datasets/ipc';
import { getPluginInfo } from 'plugins';
import { describeRepository } from 'repositories/ipc';


const DatasetMenuItem: React.FC<{ workDir: string; datasetID: string; showRepoInfo?: true; onClick?: () => void; }> =
function ({ workDir, datasetID, showRepoInfo, onClick }) {
  const dsDescResp = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetPath: datasetID },
    { info: null });

  const dsInfo = dsDescResp.value.info;
  //const isLoading = dsDescResp.isUpdating;
  //const notFound = !isLoading && !dsInfo;
  const pluginDescResp = getPluginInfo.renderer!.useValue(
    { id: dsInfo?.type.id ?? '' },
    { plugin: null });

  const pluginInfo = pluginDescResp.value.plugin;

  const effectiveIconEl: JSX.Element = pluginDescResp.isUpdating
    ? <Icon icon="circle" />
    : !pluginInfo?.iconURL
      ? <Icon icon="heart-broken" />
      : <Icon
        icon={<img className={Classes.ICON}
          css={css`height: ${IconSize.STANDARD}px; width: ${IconSize.STANDARD}px`}
          src={pluginInfo?.iconURL} />} />;

  return (
    <MenuItem
      icon="database"
      intent="primary"
      disabled={!dsInfo || !pluginInfo || !onClick}
      labelElement={<>{pluginInfo?.title}&nbsp;{effectiveIconEl}</>}
      text={<>
        {showRepoInfo
          ? <small css={css`font-variation-settings: 'GRAD' 500, 'opsz' 20;`}><RepositoryTitle workDir={workDir} />: </small>
          : null}
        {dsInfo?.title ?? datasetID}
      </>}
      title={dsInfo?.title ?? datasetID}
      onClick={onClick} />
  );
};


const RepositoryTitle: React.FC<{ workDir: string }> = function ({ workDir }) {
  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } } });

  const repo = openedRepoResp.value.info;

  return <>
    {repo.paneronMeta?.title ?? '(no repository title)'}
  </>;
}


export default DatasetMenuItem;
