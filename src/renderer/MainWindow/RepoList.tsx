/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { splitEvery } from 'ramda';
import memoize from 'memoize-one';
import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { useContext, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { AnchorButton, Button, Classes, Colors, ControlGroup, InputGroup } from '@blueprintjs/core';
import { Tooltip2 } from '@blueprintjs/popover2';
import makeGrid, { GridData } from '@riboseinc/paneron-extension-kit/widgets/Grid';
import ItemCount from '@riboseinc/paneron-extension-kit/widgets/ItemCount';
import useDebounce from 'renderer/useDebounce';
import { createRepository, Repository } from 'repositories/ipc';
import { Context } from './context';
import useRepositoryList from './useRepositoryList';
import PaneronSettingsSidebar from './PaneronSettingsSidebar';
import SelectedRepositorySidebar from './repositories/SelectedRepositorySidebar';
import RepoGridCell from './repositories/RepoGridCell';
import ImportRepositorySidebar from './repositories/ImportRepositorySidebar';


const RepoList: React.FC<{ className?: string }> =
function ({ className }) {
  const { state, dispatch, stateLoaded, isBusy, performOperation } = useContext(Context);

  const normalizedRepoFilterString = useDebounce(
    state.repoQuery.matchesText?.trim() ?? '',
    250);

  const repositories = useRepositoryList({
    matchesText: normalizedRepoFilterString.trim(),
  });

  const [selectedRepoCache, setSelectedRepoCache] = useState<Repository | undefined>(undefined);

  const [specialSidebar, setSpecialSidebar] = useState<'settings' | 'import'>('settings');

  const getGridData = memoize(function getGridData(viewportWidth: number): GridData | null {
    const cellsPerRow = Math.floor(viewportWidth / GRID_CELL_W_PX);
    const cellWidth = viewportWidth / cellsPerRow;
    return {
      items: splitEvery(
        cellsPerRow,
        repositories.value.objects.map(repo => repo.gitMeta.workingCopyPath)),
      selectedItem: state.selectedRepoWorkDir,
      selectItem: (workDir, repoInfo) => {
        dispatch({ type: 'select-repo', workDir });
        setSelectedRepoCache(repoInfo as Repository);
      },
      openItem: (workDir) => dispatch({ type: 'open-repo-settings', workDir }),
      cellWidth: cellWidth,
      cellHeight: GRID_CELL_H_PX,
      padding: GRID_PADDING_PX,
      extraData: {},
    }
  });

  useEffect(() => {
    if (stateLoaded && !repositories.isUpdating) {
      if (state.selectedDatasetID &&
          repositories.selectDataset(state.selectedRepoWorkDir, state.selectedDatasetID) === undefined) {
        log.warn("Main window: Can’t show dataset: Missing dataset or repository",
          state.selectedRepoWorkDir, state.selectedDatasetID, repositories.value);
        dispatch({ type: 'select-dataset', datasetID: null });
        dispatch({ type: 'close-dataset' });
      } else if (state.selectedRepoWorkDir &&
          repositories.selectRepo(state.selectedRepoWorkDir) === undefined) {
        log.warn("Main window: Can’t show repo-settings: Missing repository",
          state.selectedRepoWorkDir, repositories.value);
        dispatch({ type: 'select-repo', workDir: null });
        dispatch({ type: 'close-repo' });
      }
    }
  }, [stateLoaded, state.view, repositories.isUpdating]);

  let sidebar: JSX.Element;
  if (state.selectedRepoWorkDir !== null) {
    sidebar = <SelectedRepositorySidebar
      workDir={state.selectedRepoWorkDir}
      repoInfo={selectedRepoCache}
      className={Classes.ELEVATION_1}
      css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
    />;
  } else if (specialSidebar === 'import') {
    sidebar = <ImportRepositorySidebar
      onCreate={(workDir) => { setSpecialSidebar('settings'); dispatch({ type: 'open-repo-settings', workDir }) }}
      className={Classes.ELEVATION_1}
      css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
    />;
  } else {
    sidebar = <PaneronSettingsSidebar 
      className={Classes.ELEVATION_1}
      css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
    />;
  }

  return (
    <div css={css`display: flex; flex-flow: column nowrap; overflow: hidden;`} className={className}>
      <Helmet>
        <title>Your Paneron repositories</title>
      </Helmet>

      <div css={css`flex: 1; display: flex; flex-flow: row nowrap; overflow: hidden;`}>
        <div css={css`flex: 1; display: flex; flex-flow: column nowrap; overflow: hidden;`}>
          <div
              css={css`
                display: flex; flex-flow: row nowrap; align-items: center;
                background: linear-gradient(to bottom, ${Colors.LIGHT_GRAY5}, ${Colors.LIGHT_GRAY4});
                height: 24px;
                overflow: hidden;
                z-index: 1;
              `}
              className={Classes.ELEVATION_1}>
            <ControlGroup fill>
              <Query />
              <Tooltip2 content="Create new repository">
                <Button icon="add" title="Create new repository"
                  disabled={isBusy}
                  onClick={performOperation('creating repository', async () => {
                    await createRepository.renderer!.trigger({});
                  })} />
              </Tooltip2>
              <Tooltip2 content="Import shared repository">
                <AnchorButton icon="import" title="Import shared repository"
                  disabled={isBusy}
                  active={state.selectedRepoWorkDir === null && specialSidebar === 'import'}
                  onClick={() => { dispatch({ type: 'select-repo', workDir: null }); setSpecialSidebar('import')} } />
              </Tooltip2>
              <Button icon="settings" title="Show Paneron settings"
                disabled={isBusy}
                active={state.selectedRepoWorkDir === null && specialSidebar === 'settings'}
                onClick={() => { dispatch({ type: 'select-repo', workDir: null }); setSpecialSidebar('settings') }} />
            </ControlGroup>
          </div>

          <div css={css`flex: 1;`}>
            <RepoGrid getGridData={getGridData} />
          </div>
        </div>

        {sidebar}
      </div>

      <ItemCount
        css={css`font-size: 80%; height: 24px; padding: 0 10px; background: ${Colors.LIGHT_GRAY5}; z-index: 2;`}
        className={Classes.ELEVATION_2}
        descriptiveName={{ singular: 'repository', plural: 'repositories' }}
        totalCount={repositories.value.objects.length}
        onRefresh={() => repositories.refresh()}
        progress={repositories.isUpdating
          ? { phase: 'reading' }
          : undefined} />
    </div>
  );
};


const GRID_CELL_W_PX = 150;
const GRID_CELL_H_PX = 80;
const GRID_PADDING_PX = 10;


const RepoGrid = makeGrid(RepoGridCell);


const Query: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { repoQuery }, dispatch, stateLoaded } = useContext(Context);

  return (
    <>
      <Tooltip2 content="Sort by most recently loaded first">
        <Button
          disabled={!stateLoaded}
          active={repoQuery.sortBy === 'recentlyLoaded'}
          icon="history"
          title="Sort by most recently loaded"
          onClick={() => repoQuery.sortBy === 'recentlyLoaded'
            ? dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: undefined }})
            : dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: 'recentlyLoaded' }})}
        />
      </Tooltip2>
      <InputGroup
        fill
        disabled={!stateLoaded}
        className={className}
        value={repoQuery.matchesText ?? ''}
        placeholder="Search by title…"
        leftIcon="search"
        onChange={(evt: React.FormEvent<HTMLInputElement>) =>
          dispatch({
            type: 'update-query',
            payload: {
              ...repoQuery,
              matchesText: evt.currentTarget.value,
            },
          }) } />
    </>
  );
}


export default RepoList;
