/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { useContext } from 'react';
import { IconName } from '@blueprintjs/core';
import { Context } from './context';
import { describeRepository } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';


export interface NavBreadcrumb {
  icon?: { blueprintIconName: IconName } | { fileName: string }
  title: string | JSX.Element
  onClose?: () => void
  onNavigate?: () => void
}


export interface NavProps {
  className?: string
}


const Nav: React.FC<NavProps> = function ({ className }) {
  const { state, dispatch } = useContext(Context);

  const openedRepo = describeRepository.renderer!.useValue(
    { workingCopyPath: state.selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: state.selectedRepoWorkDir ?? '' } } }).value.info;

  const openedDataset = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: state.selectedRepoWorkDir ?? '', datasetPath: state.selectedDatasetID ?? '' },
    { info: null }).value.info;

  let breadcrumbs: NavBreadcrumb[] = [{
    title: 'Paneron',
    onClose: undefined,
    onNavigate: state.view !== 'repo-list'
      ? () => dispatch({ type: 'close-repo' })
      : undefined,
  }];

  if (openedRepo && state.view !== 'repo-list') {
    const title = openedRepo.paneronMeta?.title ?? openedRepo.gitMeta?.workingCopyPath;
    breadcrumbs.push({
      title,
      onClose: () => dispatch({ type: 'close-repo' }),
      onNavigate: state.view === 'dataset'
        ? () => dispatch({ type: 'close-dataset' })
        : undefined,
    });
  }

  if (state.selectedDatasetID && openedDataset && state.view === 'dataset') {
    breadcrumbs.push({
      title: state.selectedDatasetID,
      onNavigate: undefined,
    });
  }

  return (
    <div
        css={css`display: flex; flex-flow: row nowrap; align-items: center;`}
        className={className}>
      {breadcrumbs.map((bc, idx) =>
        <Breadcrumb
          key={idx}
          {...bc}
          isCurrent={idx === breadcrumbs.length - 1}
        />
      )}
    </div>
  );
};


const Breadcrumb: React.FC<NavBreadcrumb & { isCurrent: boolean }> =
function ({ icon, title, onClose, onNavigate, isCurrent }) {
  return (
    <div css={css`${isCurrent ? 'font-weight: bold' : ''}`} onClick={onNavigate}>
      {title}
    </div>
  );
}


export default Nav;
