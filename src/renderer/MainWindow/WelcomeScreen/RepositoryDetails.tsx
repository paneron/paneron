/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useCallback, useEffect, useState } from 'react';
import { jsx, css } from '@emotion/react';
import { Menu, MenuDivider, MenuItem, NonIdealState, Panel, PanelStack2, Spinner } from '@blueprintjs/core';
import { describeRepository, Repository, repositoryBuffersChanged } from 'repositories/ipc';
import RepositorySettings from './RepositorySettings';
import InitializeDataset from './InitializeDataset';
import DatasetMenuItem from './DatasetMenuItem';


const RepositoryDetails: React.FC<{ workDir: string; onOpen: (datasetID: string) => void; }> = function ({ workDir, onOpen }) {
  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } } });

  const repo = openedRepoResp.value.info;

  repositoryBuffersChanged.renderer!.useEvent(async ({ workingCopyPath }) => {
    if (workingCopyPath === workDir) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  const repoSettingsPanel: Panel<RepoSettingsProps> = {
    title: "Settings",
    renderPanel: () => <RepositorySettings
      workDir={workDir}
      repoInfo={repo}
      css={css`overflow-y: auto; flex: 1; padding: 10px;`}
    />,
    props: {},
  };

  const createDatasetPanel: Panel<CreateDatasetProps> = {
    title: "Initialize new dataset",
    renderPanel: () => <InitializeDataset workDir={workDir} repoInfo={repo} />,
    props: {},
  };

  const repoMenuPanel: Panel<RepoMenuProps> = {
    title: repo.paneronMeta?.title ?? `${workDir.slice(0, 10)}…`,
    props: {
      repo: repo,
      onOpenDataset: onOpen,
    },
    renderPanel: ({ repo, onOpenDataset, closePanel, openPanel }) => <RepoMenu
      repo={repo}
      onOpenDataset={onOpenDataset}
      onOpenSettings={() => openPanel(repoSettingsPanel)}
      onCreateDataset={() => openPanel(createDatasetPanel)} />,
  };

  useEffect(() => {
    setPanelStack([repoMenuPanel]);
  }, [JSON.stringify(repo)]);

  const [panelStack, setPanelStack] = useState<
    [Panel<RepoMenuProps>] |
    [Panel<RepoMenuProps>, Panel<CreateDatasetProps>] |
    [Panel<RepoMenuProps>, Panel<RepoSettingsProps>]
  >([repoMenuPanel]);

  const handleOpenPanel = useCallback((newPanel: Panel<CreateDatasetProps | RepoSettingsProps>) => setPanelStack(stack => {
    if (stack.length === 1) {
      return [...stack, newPanel];
    } else {
      return stack;
    }
  }), []);

  const handleClosePanel = useCallback(() => {
    setPanelStack(stack => [stack[0]]);
  }, []);

  if (repo) {
    return (
      <PanelStack2
        stack={panelStack as Array<Panel<object>>}
        onClose={handleClosePanel}
        onOpen={handleOpenPanel}
        css={css`position: absolute; inset: 0;`}
      />
    );
  } else if (openedRepoResp.isUpdating) {
    return <NonIdealState icon={<Spinner />} />;
  } else {
    return <NonIdealState icon="heart-broken" description="Repository failed to load" />;
  }
};

interface CreateDatasetProps {
}
interface RepoSettingsProps {
}
interface RepoMenuProps {
  repo: Repository;
  onOpenDataset?: (datasetID: string) => void;
  onOpenSettings?: () => void;
  onCreateDataset?: () => void;
}
const RepoMenu: React.FC<RepoMenuProps> = function ({ repo, onOpenDataset, onOpenSettings, onCreateDataset }) {
  const { workingCopyPath: workDir } = repo.gitMeta;

  const settingsMenuItem: JSX.Element = (
    <MenuItem
      text="Repository settings"
      icon="settings"
      onClick={onOpenSettings}
      disabled={!onOpenSettings} />
  );

  if (repo.paneronMeta) {
    const datasetIDs = Object.keys(repo.paneronMeta?.datasets ?? {});
    return (
      <Menu>
        <MenuDivider title="Datasets" />
        {datasetIDs.map(dsID => <DatasetMenuItem
          key={dsID}
          workDir={workDir}
          datasetID={dsID}
          onClick={onOpenDataset ? () => onOpenDataset!(dsID) : undefined} />)}
        <MenuDivider title="Manage" />
        <MenuItem
          text="Create new dataset"
          icon="add"
          onClick={onCreateDataset}
          disabled={!onCreateDataset} />
        {settingsMenuItem}
      </Menu>
    );
  } else {
    return <>
      <NonIdealState icon="heart-broken" description="This does not appear to be a Paneron repository." />
      <Menu>
        {settingsMenuItem}
      </Menu>
    </>
  }

};


export default RepositoryDetails;
