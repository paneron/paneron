/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { ComponentType, useContext, useEffect } from 'react';
import { splitEvery } from 'ramda';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, GridChildComponentProps } from 'react-window';
import useRepositoryList from 'renderer/repositories/useRepositoryList';
import useDebounce from 'renderer/useDebounce';
import { describeRepository } from 'repositories/ipc';
import { Context } from './context';
import { Button, ControlGroup, InputGroup } from '@blueprintjs/core';


const RepoList: React.FC<Record<never, never>> =
function () {
  const { state, dispatch, stateLoaded } = useContext(Context);

  const normalizedRepoFilterString = useDebounce(
    state.repoQuery.matchesText?.trim() ?? '',
    250);

  const repositories = useRepositoryList({
    matchesText: normalizedRepoFilterString.trim(),
  });

  function getGridData(viewportWidth: number): RepoGridData {
    return {
      items: splitEvery(
        Math.floor(viewportWidth / REPO_CELL_SIDE_PX),
        repositories.value.objects.map(repo => repo.gitMeta.workingCopyPath)),
      selectedWorkDir: state.selectedRepoWorkDir,
      selectWorkDir: (workDir) => dispatch({ type: 'select-repo', workDir }),
    }
  }

  useEffect(() => {
    if (stateLoaded && !repositories.isUpdating) {
      if (state.view === 'dataset' &&
          repositories.selectDataset(state.selectedRepoWorkDir, state.selectedDatasetID) === undefined) {
        log.warn("Main window: Can’t show dataset: Missing dataset or repository",
          state.selectedRepoWorkDir, state.selectedDatasetID, repositories.value);
        dispatch({ type: 'close-dataset' });
      } else if (state.view === 'repo-settings' &&
          repositories.selectRepo(state.selectedRepoWorkDir) === undefined) {
        log.warn("Main window: Can’t show repo-settings: Missing repository",
          state.selectedRepoWorkDir, repositories.value);
        dispatch({ type: 'close-repo' });
      }
    }
  }, [stateLoaded, state.view, repositories.isUpdating]);

  return (
    <div css={css`display: flex; flex-flow: column nowrap;`}>
      <div css={css`flex: 1;`}>
        <AutoSizer>
          {({ width, height }) => {
            const itemData = getGridData(width);
            const columnCount = itemData.items[0].length;
            const rowCount = itemData.items.length;
            return (
              <Grid
                  width={width}
                  height={height}
                  columnCount={columnCount}
                  columnWidth={REPO_CELL_SIDE_PX}
                  rowCount={rowCount}
                  rowHeight={REPO_CELL_SIDE_PX}
                  itemData={itemData}>
                {RepoCell}
              </Grid>
            );
          }}
        </AutoSizer>
      </div>
      <Query />
    </div>
  );
};


const REPO_CELL_SIDE_PX = 40;


interface RepoGridData {
  items: string[][] // repository working directory paths, chunked into rows
  selectedWorkDir: string | null
  selectWorkDir: (workDir: string) => void
}


const RepoCell: ComponentType<GridChildComponentProps> = ({ columnIndex, rowIndex, data, style }) => {
  const _data: RepoGridData = data;
  return (
    <div style={style}>
      <Repo workDir={_data.items[rowIndex][columnIndex]} />
    </div>
  );
};


const Repo: React.FC<{ workDir: string }> = function ({ workDir }) {
  const description = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir }, paneronMeta: undefined } });

  return (
    <div>Repository {workDir}: {description.value.info.paneronMeta?.title}</div>
  );
};


const Query: React.FC<Record<never, never>> = function () {
  const { state: { repoQuery }, dispatch, stateLoaded } = useContext(Context);

  return (
    <ControlGroup>
      <InputGroup
        disabled={!stateLoaded}
        onChange={(evt: React.FormEvent<HTMLInputElement>) =>
          dispatch({
            type: 'update-query',
            payload: {
              ...repoQuery,
              matchesText: evt.currentTarget.value,
            },
          }) } />
      <Button
        disabled={!stateLoaded}
        active={repoQuery.sortBy === 'recentlyLoaded'}
        icon="history"
        onClick={() => repoQuery.sortBy === 'recentlyLoaded'
          ? dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: undefined }})
          : dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: 'recentlyLoaded' }})}
      />
    </ControlGroup>
  );
}


export default RepoList;
