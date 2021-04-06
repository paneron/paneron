/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { useContext } from 'react';
import { Classes, Colors, Icon } from '@blueprintjs/core';
import { describeRepository } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Context } from '../context';
import Breadcrumb from './Breadcrumb';
import DatasetBreadcrumb from './DatasetBreadcrumb';
import RepoBreadcrumb from './RepoBreadcrumb';


export interface NavProps {
  className?: string
}


const Nav: React.FC<NavProps> = function ({ className }) {
  const { state, dispatch, showMessage } = useContext(Context);

  const openedRepo = describeRepository.renderer!.useValue(
    { workingCopyPath: state.selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: state.selectedRepoWorkDir ?? '' } } }).value.info;

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

  if (openedRepo && state.view !== 'repo-list') {
    breadcrumbs.push(<RepoBreadcrumb
      key={state.selectedRepoWorkDir}
      repoInfo={openedRepo}
      workDir={state.selectedRepoWorkDir}
      onMessage={showMessage}
      onClose={() => dispatch({ type: 'close-repo' })}
      onNavigate={state.view === 'dataset'
        ? () => dispatch({ type: 'close-dataset' })
        : undefined}
    />);
  }

  breadcrumbs.push(<Breadcrumb
    key="paneron"
    title={'Paneron'}
    icon={{ type: 'file', fileName: `file://${__static}/icon.png` }}
    onNavigate={state.view !== 'repo-list'
      ? () => dispatch({ type: 'close-repo' })
      : undefined}
  />);

  return (
    <div
        css={css`
          display: flex; flex-flow: row nowrap; align-items: center;
          font-size: 80%;
          box-sizing: border-box;
          background: linear-gradient(to bottom, ${Colors.LIGHT_GRAY5}, ${Colors.LIGHT_GRAY3});
          line-height: 0;
          transform: skew(-45deg) translateX(15px);
          padding: 0 25px;
          transition: width 1s linear;
        `}
        className={`${className ?? ''} ${Classes.ELEVATION_2}`}>
      {breadcrumbs.map((bc, idx) =>
        <>
          {idx !== 0
            ? <Icon icon="chevron-left" iconSize={10} key={idx} css={css`transform: skew(45deg)`} />
            : null}
          {bc}
        </>
      )}
    </div>
  );
};


export default Nav;
