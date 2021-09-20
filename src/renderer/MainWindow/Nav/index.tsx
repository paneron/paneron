/** @jsx jsx */
/** @jsxFrag React.Fragment */

import styled from '@emotion/styled';
import { jsx, css } from '@emotion/react';
import React, { useContext } from 'react';
import { Button, Classes, Colors, Icon } from '@blueprintjs/core';
import { describeRepository, repositoryBuffersChanged } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Context } from '../context';
import Breadcrumb from './Breadcrumb';
import DatasetBreadcrumb from './DatasetBreadcrumb';
import RepoBreadcrumb from './RepoBreadcrumb';


export interface NavProps {
  onOpenSettings: () => void
  className?: string
}


const Nav: React.FC<NavProps> = function ({ onOpenSettings, className }) {
  const { state, dispatch, showMessage } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: state.selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: state.selectedRepoWorkDir ?? '', mainBranch: '' } } });

  const openedRepo = openedRepoResp.value.info;

  repositoryBuffersChanged.renderer!.useEvent(async ({ workingCopyPath }) => {
    if (workingCopyPath === state.selectedRepoWorkDir) {
      openedRepoResp.refresh();
    }
  }, [state.selectedRepoWorkDir]);

  const openedDataset = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: state.selectedRepoWorkDir ?? '', datasetPath: state.selectedDatasetID ?? '' },
    { info: null }).value.info;

  let breadcrumbs: JSX.Element[] = [];

  if (state.selectedDatasetID && openedDataset && state.view === 'dataset') {
    breadcrumbs.push(<DatasetBreadcrumb
      key={state.selectedDatasetID}
      workDir={state.selectedRepoWorkDir}
      datasetID={state.selectedDatasetID}
      datasetInfo={openedDataset}
      onClose={() => dispatch({ type: 'close-dataset' })}
    />);
  }

  if (openedRepo && state.view !== 'welcome-screen') {
    breadcrumbs.push(<RepoBreadcrumb
      key={state.selectedRepoWorkDir}
      repoInfo={openedRepo}
      workDir={state.selectedRepoWorkDir}
      onMessage={showMessage}
    />);
  }

  breadcrumbs.push(<Breadcrumb
    key="paneron"
    title={'Paneron'}
    icon={{ type: 'file', fileName: `file://${__static}/icon.png` }}
    onNavigate={state.view !== 'welcome-screen'
      ? () => dispatch({ type: 'close-dataset' })
      : undefined}
  />);

  return (
    <div
        css={css`
          display: flex; flex-flow: row nowrap; align-items: stretch;
          justify-content: flex-end;
          font-size: 80%;
          box-sizing: border-box;
          background: linear-gradient(to bottom, ${Colors.LIGHT_GRAY5}, ${Colors.LIGHT_GRAY3});
          line-height: 0;
          transform: skew(-45deg);
          padding: 0 25px;
          transition: width 1s linear;
        `}
        className={`${className ?? ''} ${Classes.ELEVATION_2}`}>
      {breadcrumbs.map((bc, idx) =>
        <React.Fragment key={idx}>
          {idx !== 0
            ? <BreadcrumbSeparator icon="chevron-left" iconSize={10} />
            : null}
          {bc}
        </React.Fragment>
      )}
      <Button
        small
        minimal
        icon="settings"
        css={css`transform: skew(45deg); border-radius: 0;`}
        title="Settings"
        disabled={!onOpenSettings}
        onClick={onOpenSettings}
      />
    </div>
  );
};


const BreadcrumbSeparator = styled(Icon)`
  transform: skew(45deg);
  align-self: center;
`


export default Nav;
