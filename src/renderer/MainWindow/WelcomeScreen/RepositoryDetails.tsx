/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useCallback, useContext, useEffect, useState } from 'react';
import { jsx, css } from '@emotion/react';
import { Menu, MenuDivider, MenuItem, NonIdealState, Panel, PanelStack2, Spinner } from '@blueprintjs/core';
import { addDisconnected, describeRepository, loadRepository, Repository, repositoryBuffersChanged } from 'repositories/ipc';
import RepositorySettings from './RepositorySettings';
import InitializeDataset from './InitializeDataset';
import DatasetMenuItem from './DatasetMenuItem';
import { Context } from '../context';


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

  useEffect(() => {
    // If this repository has remote connected, load repository in order to sync
    if (repo.gitMeta.remote?.url) {
      console.debug("Loading repository to sync with remote", workDir, repo.gitMeta.remote?.url);
      loadRepository.renderer!.trigger({ workingCopyPath: workDir });
    } else {
      console.debug("Not loading repository (no remote connected?)", workDir, repo.gitMeta.remote?.url);
    }
  }, [JSON.stringify(repo.gitMeta.remote?.url)]);

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

  const { performOperation, isBusy } = useContext(Context);

  const makePrivateCopy = repo.gitMeta.remote && !isBusy
    ? performOperation('making private working copy', async () => {
        repo.gitMeta.remote
          ? await addDisconnected.renderer!.trigger({
              gitRemoteURL: repo.gitMeta.remote.url,
              username: repo.gitMeta.remote.username,
              branch: repo.gitMeta.mainBranch,
            })
          : void 0;
      })
    : () => void 0;

  const publishingToRemote = repo.gitMeta.remote?.writeAccess === true;
  const fetchingChanges = repo.gitMeta.remote && repo.gitMeta.remote?.writeAccess !== true;
  const sharingMenu = publishingToRemote
    ? <>
        <MenuItem
          text="Remote connected"
          icon="cloud"
          disabled />
        <MenuItem
          text="Make private working copy"
          title="Good for experiments and tests."
          onClick={makePrivateCopy}
          icon="lab-test" />
      </>
    : fetchingChanges
      ? <MenuItem
          text="Remote connected (fetching only)"
          icon="cloud-download"
          disabled />
      : null;

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
        <MenuItem
          text="Create new dataset"
          icon="add"
          onClick={onCreateDataset}
          disabled={!onCreateDataset} />
        <MenuDivider />
        {settingsMenuItem}
        {sharingMenu}
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
