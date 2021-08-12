/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import { Helmet } from 'react-helmet';
import React, { useContext, useState } from 'react';
import { splitEvery } from 'ramda';
import { Button, Classes, Colors, ControlGroup, InputGroup, NonIdealState } from '@blueprintjs/core';
import makeGrid, { CellProps, GridData, LabelledGridIcon } from '@riboseinc/paneron-extension-kit/widgets/Grid';
import Workspace from '@riboseinc/paneron-extension-kit/widgets/Workspace';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import PropertyView from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { describeRepository, repositoryBuffersChanged } from 'repositories/ipc';
import { DatasetInfo } from 'datasets/types';
import { deleteDataset, getDatasetInfo } from 'datasets/ipc';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { getPluginInfo } from 'plugins';
import DatasetExtension from 'plugins/renderer/DatasetExtensionCard';
import { Context } from './context';
import SelectedRepositorySidebar from './repositories/SelectedRepositorySidebar';
import InitializeDatasetSidebar from './repositories/InitializeDatasetSidebar';


const CELL_WIDTH_PX = 150;


const RepoSettings: React.FC<{ className?: string }> =
function ({ className }) {
  const { state: { selectedRepoWorkDir, selectedDatasetID }, dispatch } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: selectedRepoWorkDir ?? '' },
    { info: { gitMeta: { workingCopyPath: selectedRepoWorkDir ?? '', mainBranch: '' } } });

  const [specialSidebar, setSpecialSidebar] = useState<'initialize-dataset' | 'settings'>('settings');

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
          active={specialSidebar === 'initialize-dataset' && selectedDatasetID === null}
          icon="add"
          onClick={() => { dispatch({ type: 'select-dataset', datasetID: null }); setSpecialSidebar('initialize-dataset') }}>
        Initialize new dataset within this repository
      </Button>
      <Button
        icon="settings"
        active={specialSidebar === 'settings' && selectedDatasetID === null}
        title="Show repository settings"
        onClick={() => { dispatch({ type: 'select-dataset', datasetID: null }); setSpecialSidebar('settings') }}
      />
    </ControlGroup>
  );

  function getGridData(viewportWidth: number): GridData<DatasetGridData> | null {
    if (selectedRepoWorkDir) {
      return {
        items: splitEvery(
          Math.floor(viewportWidth / CELL_WIDTH_PX) || 1,
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

  let mainView: JSX.Element;
  let sidebar: JSX.Element | undefined;
  if (selectedRepoWorkDir) {
    mainView = <Grid getGridData={getGridData} />;
    if (selectedDatasetID) {
      sidebar = <SelectedDatasetSidebar
        workDir={selectedRepoWorkDir}
        datasetDir={selectedDatasetID}
        css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
      />;
    } else if (specialSidebar === 'initialize-dataset') {
      sidebar = <InitializeDatasetSidebar
        workDir={selectedRepoWorkDir}
        css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
      />;
    } else {
      sidebar = <SelectedRepositorySidebar
        workDir={selectedRepoWorkDir}
        css={css`width: 280px; background: ${Colors.LIGHT_GRAY5}; z-index: 1;`}
        repoInfo={openedRepoResp.value.info} />
    }
  } else {
    mainView = <NonIdealState title="No repository is selected" />;
    sidebar = undefined;
  }

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
      {mainView}
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
  const { performOperation, isBusy, dispatch } = useContext(Context);

  const openedDatasetResp = getDatasetInfo.renderer!.useValue(
    { workingCopyPath: workDir, datasetPath: datasetDir },
    { info: null });

  const openedDataset = openedDatasetResp.value.info;

  const ds = openedDatasetResp.isUpdating ? (datasetInfo ?? openedDataset) : openedDataset;

  const pluginInfo = getPluginInfo.renderer!.useValue(
    { id: ds?.type.id ?? ''},
    { plugin: null });

  const canDelete = !openedDatasetResp.isUpdating && !isBusy;

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
    }, {
      key: 'delete-dataset',
      title: "Delete",
      collapsedByDefault: true,
      content: <>
        <Button small fill minimal
          disabled={!canDelete}
          intent={canDelete ? 'danger' : undefined}
          onClick={canDelete
            ? performOperation('deleting dataset', async () => {
                await deleteDataset.renderer!.trigger({ workingCopyPath: workDir, datasetPath: datasetDir });
                dispatch({ type: 'select-dataset', datasetID: null });
              })
            : undefined}>
          Delete this dataset
        </Button>
      </>,
    }]}
    className={className} />;
};
