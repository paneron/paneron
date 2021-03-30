/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { ComponentType, useContext, useState } from 'react';
import { splitEvery } from 'ramda';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, GridChildComponentProps } from 'react-window';
import { NonIdealState, ProgressBar, Text } from '@blueprintjs/core';
import { describeRepository, repositoryStatusChanged, RepoStatus } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Context } from './context';


const RepoSettings: React.FC<Record<never, never>> =
function () {
  const { state: { selectedRepoWorkDir }, dispatch } = useContext(Context);

  const openedRepo = describeRepository.renderer!.useValue(
    { workingCopyPath: selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: selectedRepoWorkDir ?? '' } } }).value.info;

  const datasetIDs = Object.keys(openedRepo.paneronMeta?.datasets ?? {});

  function getGridData(viewportWidth: number): DatasetGridData | null {
    if (selectedRepoWorkDir) {
      return {
        items: splitEvery(
          Math.floor(viewportWidth / GRID_CELL_SIDE_PX),
          datasetIDs),
        workDir: selectedRepoWorkDir,
        selectedDatasetID: selectedRepoWorkDir,
        selectDatasetID: (datasetID) => dispatch({ type: 'select-dataset', datasetID }),
      }
    }
    return null;
  }

  return (
    <div css={css`display: flex; flex-flow: column nowrap;`}>
      <div css={css`flex: 1;`}>
        <AutoSizer>
          {({ width, height }) => {
            const itemData = getGridData(width);
            if (itemData) {
              const rowCount = itemData.items.length;
              // The first row (chunk) will have the maximum number of columns:
              const columnCount = itemData.items[0].length;
              return (
                <Grid
                    width={width}
                    height={height}
                    columnCount={columnCount}
                    columnWidth={GRID_CELL_SIDE_PX}
                    rowCount={rowCount}
                    rowHeight={GRID_CELL_SIDE_PX}
                    itemData={itemData}>
                  {DatasetCell}
                </Grid>
              );
            } else {
              return <NonIdealState icon="heart-broken" title="Nothing to display" />
            }
          }}
        </AutoSizer>
      </div>
      <RepoStatusBar />
    </div>
  );
}


const GRID_CELL_SIDE_PX = 40;


interface DatasetGridData {
  items: string[][] // repository working directory paths, chunked into rows
  workDir: string
  selectedDatasetID: string | null
  selectDatasetID: (datasetID: string | null) => void
}


const DatasetCell: ComponentType<GridChildComponentProps> =
function ({ columnIndex, rowIndex, data, style }) {
  const _data: DatasetGridData = data;
  const datasetID = _data.items[rowIndex][columnIndex];
  const isSelected = _data.selectedDatasetID === datasetID;
  return (
    <div style={style}>
      <Dataset
        isSelected={isSelected}
        workDir={_data.workDir}
        datasetID={datasetID}
      />
    </div>
  );
};


const Dataset: React.FC<{ isSelected: boolean, workDir: string, datasetID: string }> =
function ({ isSelected, workDir, datasetID }) {
  const description = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetPath: datasetID },
    { info: null });

  return (
    <div css={css`${isSelected ? 'font-weight: bold' : ''}`}>
      Dataset {workDir}: {description.value.info?.title}
    </div>
  );
};


const RepoStatusBar: React.FC<Record<never, never>> =
function () {
  const { state: { selectedRepoWorkDir } } = useContext(Context);

  const [status, setStatus] = useState<RepoStatus>({ status: 'ready' });
  repositoryStatusChanged.renderer!.useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath === selectedRepoWorkDir) {
      setStatus(status);
    }
  }, []);

  let maybeProgressBar: JSX.Element | null;
  switch (status.busy?.operation) {
    case 'pushing':
    case 'pulling': // @ts-ignore: fallthrough case in switch
    case 'cloning':
      maybeProgressBar = <>
        <Text ellipsize>
          {status.busy.progress?.phase}
        </Text>
        <ProgressBar
          value={status.busy.progress
            ? status.busy.progress.loaded / status.busy.progress.total
            : undefined} />
      </>;
    default:
      maybeProgressBar = null;
  }

  return (
    <div css={css`display: flex; flex-flow: row nowrap; align-items: center;`}>
      <Text ellipsize>{status.status}</Text>
      {maybeProgressBar}
    </div>
  );
};


export default RepoSettings;
