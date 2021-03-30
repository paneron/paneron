/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { splitEvery } from 'ramda';
import log from 'electron-log';
import { jsx, css } from '@emotion/core';
import React, { ComponentType, useContext, useEffect, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, GridChildComponentProps } from 'react-window';
import { Button, ButtonGroup, Classes, ControlGroup, Dialog, InputGroup } from '@blueprintjs/core';
import useRepositoryList from 'renderer/repositories/useRepositoryList';
import useDebounce from 'renderer/useDebounce';
import { createRepository, describeRepository } from 'repositories/ipc';
import { Context } from './context';
import AddSharedRepoForm from './AddSharedRepoForm';


const RepoList: React.FC<Record<never, never>> =
function () {
  const { state, dispatch, stateLoaded, showMessage } = useContext(Context);

  const normalizedRepoFilterString = useDebounce(
    state.repoQuery.matchesText?.trim() ?? '',
    250);

  const repositories = useRepositoryList({
    matchesText: normalizedRepoFilterString.trim(),
  });

  const [busy, setBusy] = useState(false);
  const [importDialogShown, setImportDialogShown] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await createRepository.renderer!.trigger({});
      showMessage({ icon: 'tick-circle', intent: 'success', message: "New repository was created" });
    } catch (e) {
      log.error("Error creating repository", e);
      showMessage({ icon: 'heart-broken', intent: 'danger', message: "Error creating repository" });
    } finally {
      setBusy(false);
    }
  }

  function getGridData(viewportWidth: number): RepoGridData {
    return {
      items: splitEvery(
        Math.floor(viewportWidth / GRID_CELL_SIDE_PX),
        repositories.value.objects.map(repo => repo.gitMeta.workingCopyPath)),
      selectedWorkDir: state.selectedRepoWorkDir,
      selectWorkDir: (workDir) => dispatch({ type: 'select-repo', workDir }),
    }
  }

  useEffect(() => {
    if (stateLoaded && !repositories.isUpdating) {
      if (state.selectedDatasetID &&
          repositories.selectDataset(state.selectedRepoWorkDir, state.selectedDatasetID) === undefined) {
        log.warn("Main window: Can’t show dataset: Missing dataset or repository",
          state.selectedRepoWorkDir, state.selectedDatasetID, repositories.value);
        dispatch({ type: 'close-dataset' });
      } else if (state.selectedRepoWorkDir &&
          repositories.selectRepo(state.selectedRepoWorkDir) === undefined) {
        log.warn("Main window: Can’t show repo-settings: Missing repository",
          state.selectedRepoWorkDir, repositories.value);
        dispatch({ type: 'close-repo' });
      }
    }
  }, [stateLoaded, state.view, repositories.isUpdating]);

  return (
    <div css={css`display: flex; flex-flow: column nowrap;`}>

      <ControlGroup>
        <ButtonGroup>
          <Button icon="add" title="Create new repository" disabled={busy} onClick={create} />
          <Button icon="import" title="Import shared repository" disabled={busy || importDialogShown} onClick={() => setImportDialogShown(true)} />
        </ButtonGroup>
        <Query />
      </ControlGroup>

      <Dialog title="Import shared repository" onClose={() => setImportDialogShown(false)} icon="import">
        <AddSharedRepoForm onCreate={() => setImportDialogShown(false)} />
      </Dialog>

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
                  columnWidth={GRID_CELL_SIDE_PX}
                  rowCount={rowCount}
                  rowHeight={GRID_CELL_SIDE_PX}
                  itemData={itemData}>
                {RepoCell}
              </Grid>
            );
          }}
        </AutoSizer>
      </div>
    </div>
  );
};


const GRID_CELL_SIDE_PX = 40;


interface RepoGridData {
  items: string[][] // repository working directory paths, chunked into rows
  selectedWorkDir: string | null
  selectWorkDir: (workDir: string | null) => void
}


const RepoCell: ComponentType<GridChildComponentProps> =
function ({ columnIndex, rowIndex, data, style }) {
  const _data: RepoGridData = data;

  const workDir = _data.items[rowIndex][columnIndex];

  return (
    <div style={style}>
      <Repo isSelected={_data.selectedWorkDir === workDir} workDir={workDir} />
    </div>
  );
};


const Repo: React.FC<{ workDir: string, isSelected: boolean }> =
function ({ workDir, isSelected }) {
  const description = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir }, paneronMeta: undefined } });

  return (
    <div
        css={css`${isSelected ? 'font-weight: bold' : ''}`}
        className={description.isUpdating ? Classes.SKELETON : undefined}>
      {description.value.info.paneronMeta?.title ?? '(unknown title)'}
    </div>
  );
};


const Query: React.FC<{ className?: string }> = function ({ className }) {
  const { state: { repoQuery }, dispatch, stateLoaded } = useContext(Context);

  return (
    <InputGroup
      disabled={!stateLoaded}
      className={className}
      rightElement={
        <Button
          disabled={!stateLoaded}
          active={repoQuery.sortBy === 'recentlyLoaded'}
          icon="history"
          title="Sort by most recently loaded"
          onClick={() => repoQuery.sortBy === 'recentlyLoaded'
            ? dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: undefined }})
            : dispatch({ type: 'update-query', payload: { ...repoQuery, sortBy: 'recentlyLoaded' }})}
        />
      }
      onChange={(evt: React.FormEvent<HTMLInputElement>) =>
        dispatch({
          type: 'update-query',
          payload: {
            ...repoQuery,
            matchesText: evt.currentTarget.value,
          },
        }) } />
  );
}


export default RepoList;
