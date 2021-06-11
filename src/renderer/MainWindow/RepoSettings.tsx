/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import { Helmet } from 'react-helmet';
import React, { useContext } from 'react';
import { splitEvery } from 'ramda';
import { Button, Classes, Colors, ControlGroup, InputGroup } from '@blueprintjs/core';
import makeGrid, { CellProps, GridData, LabelledGridIcon } from '@riboseinc/paneron-extension-kit/widgets/Grid';
import Workspace from '@riboseinc/paneron-extension-kit/widgets/Workspace';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import { describeRepository, repositoryBuffersChanged } from 'repositories/ipc';
import { getDatasetInfo } from 'datasets/ipc';
import { Context } from './context';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { DatasetInfo } from 'datasets/types';
import PropertyView from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { getPluginInfo } from 'plugins';
import DatasetExtension from 'plugins/renderer/DatasetExtensionCard';


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

  const toolbar = (
    <ControlGroup>
      <Button
        css={css`flex-grow: 0`}
        icon="arrow-left"
        title="Back to repository list"
        onClick={() => dispatch({ type: 'close-repo' })} />
      <Button
          fill
          icon="add"
          disabled>
        Initialize new dataset within this repository
      </Button>
      <Button
        icon="settings"
        title="Show repository settings"
        disabled />
    </ControlGroup>
  );

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

  const sidebar: JSX.Element | undefined = selectedRepoWorkDir && selectedDatasetID
    ? <SelectedDatasetSidebar
        workDir={selectedRepoWorkDir}
        datasetDir={selectedDatasetID}
        css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
      />
    : undefined;

  return (
    <Workspace
        className={className}
        toolbar={toolbar}
        sidebar={sidebar}
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


export default RepoSettings;


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


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


export const SelectedDatasetSidebar: React.FC<{
  workDir: string;
  datasetDir: string,
  datasetInfo?: DatasetInfo;
  className?: string;
}> = function ({ workDir, datasetDir, datasetInfo, className }) {
  //const { performOperation, isBusy } = useContext(Context);

  const openedDatasetResp = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetPath: datasetDir },
    { info: null });

  const openedDataset = openedDatasetResp.value.info;

  const ds = openedDatasetResp.isUpdating ? (datasetInfo ?? openedDataset) : openedDataset;

  const pluginInfo = getPluginInfo.renderer!.useValue(
    { id: ds?.type.id ?? ''},
    { plugin: null });

  //const canDelete = !openedDatasetResp.isUpdating && !isBusy;

  return <Sidebar
    stateKey='selected-dataset-panels'
    representsSelection
    title={ds?.title ?? datasetDir}
    blocks={[{
      key: 'paneron-dataset',
      title: "Dataset metadata",
      content: <>
        <PropertyView label="Title">
          <InputGroup disabled value={ds?.title ?? 'N/A'} />
        </PropertyView>
      </>,
    }, {
      key: 'dataset-extension-info',
      title: "Type/extension",
      content: 
        <DatasetExtension
          full
          extension={pluginInfo.value.plugin ?? undefined}
        />,
    }]}
    className={className} />;
};
