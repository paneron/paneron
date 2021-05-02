/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import { Helmet } from 'react-helmet';
import React, { useContext } from 'react';
import { splitEvery } from 'ramda';
import { Classes } from '@blueprintjs/core';
import makeGrid, { CellProps, GridData, LabelledGridIcon } from '@riboseinc/paneron-extension-kit/widgets/Grid';
import { describeRepository, repositoryBuffersChanged } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Context } from './context';
import Workspace from '@riboseinc/paneron-extension-kit/widgets/Workspace';


const CELL_WIDTH_PX = 150;


const RepoSettings: React.FC<{ className?: string }> =
function ({ className }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID }, dispatch } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: selectedRepoWorkDir ?? '' } } });

  repositoryBuffersChanged.renderer!.useEvent(async ({ workingCopyPath }) => {
    if (workingCopyPath === selectedRepoWorkDir) {
      openedRepoResp.refresh();
    }
  }, [selectedRepoWorkDir]);

  const openedRepo = openedRepoResp.value.info;

  const datasetIDs = Object.keys(openedRepo.paneronMeta?.datasets ?? {});

  function getGridData(viewportWidth: number): GridData<DatasetGridData> | null {
    if (selectedRepoWorkDir) {
      return {
        items: splitEvery(
          Math.floor(viewportWidth / CELL_WIDTH_PX),
          datasetIDs),
        extraData: { workDir: selectedRepoWorkDir },
        selectedItem: selectedDatasetID,
        selectItem: (datasetID) => dispatch({ type: 'select-dataset', datasetID }),
        openItem: (datasetID) => dispatch({ type: 'open-dataset', datasetID }),
        cellWidth: CELL_WIDTH_PX,
        cellHeight: 80,
        padding: 10,
      };
    }
    return null;
  }

  return (
    <Workspace
        className={className}
        statusBarProps={{
          descriptiveName: { singular: 'dataset', plural: 'datasets' },
          totalCount: datasetIDs.length,
          onRefresh: () => openedRepoResp.refresh(),
          progress: openedRepoResp.isUpdating
            ? { phase: 'reading' }
            : undefined,
        }}>
      <Helmet>
        <title>{`Repository ${openedRepo.paneronMeta?.title ?? openedRepo.gitMeta.workingCopyPath}: ${datasetIDs.length} dataset(s)`}</title>
      </Helmet>
      <Grid getGridData={getGridData} />
    </Workspace>
  );
}


interface DatasetGridData {
  workDir: string
}
const Dataset: React.FC<CellProps<DatasetGridData>> =
function ({ isSelected, onSelect, onOpen, extraData, itemRef, padding }) {
  const description = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: extraData.workDir, datasetPath: itemRef },
    { info: null });

  return (
    <LabelledGridIcon
        isSelected={isSelected}
        onSelect={onSelect}
        onOpen={onOpen}
        padding={padding}
        entityType={{ iconProps: { icon: 'database' }, name: 'dataset' }}
        contentClassName={description.isUpdating ? Classes.SKELETON : undefined}>
      {description.value.info?.title ?? itemRef}
    </LabelledGridIcon>
  );
};


const Grid = makeGrid<DatasetGridData>(Dataset);


export default RepoSettings;
