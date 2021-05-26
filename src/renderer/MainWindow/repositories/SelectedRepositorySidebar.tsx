/** @jsx jsx */
/** @jsxFrag React.Fragment */


import { jsx } from '@emotion/core';

import React, { useContext } from 'react';
import { Button } from '@blueprintjs/core';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import PropertyView from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PanelSeparator';
import ShareRepoForm from 'renderer/MainWindow/repositories/ShareRepoForm';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { deleteRepository, describeRepository, repositoriesChanged, Repository } from 'repositories/ipc';
import { Context } from '../context';


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


export const SelectedRepositorySidebar: React.FC<{ workDir: string; repoInfo?: Repository; className?: string; }> = function ({ workDir, repoInfo, className }) {
  const { performOperation, isBusy } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir } } });

  repositoriesChanged.renderer!.useEvent(async ({ changedWorkingPaths }) => {
    if ((changedWorkingPaths ?? []).indexOf(workDir) >= 0) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  const openedRepo = openedRepoResp.value.info;

  const repo = openedRepoResp.isUpdating ? (repoInfo ?? openedRepo) : openedRepo;

  const canDelete = !openedRepoResp.isUpdating && !isBusy;

  return <Sidebar
    stateKey='selected-repo-panels'
    representsSelection
    title={repo.paneronMeta?.title ?? repo.gitMeta.workingCopyPath}
    blocks={[{
      key: 'paneron-repo',
      title: "Paneron metadata",
      content: <PaneronRepoPanel paneronMeta={repo.paneronMeta} />,
    }, {
      key: 'git-repo',
      title: "DVCS repository",
      content: <GitRepoPanel gitMeta={repo.gitMeta} />,
    }, {
      key: 'workdir',
      title: "Working directory",
      content: <GitRepoPanel gitMeta={repo.gitMeta} />,
    }, {
      key: 'delete-repo',
      title: "Delete",
      collapsedByDefault: true,
      content: <>
        <Button small fill minimal
          disabled={!canDelete}
          intent={canDelete ? 'danger' : undefined}
          onClick={canDelete
            ? performOperation('deleting repository', async () => {
              await deleteRepository.renderer!.trigger({ workingCopyPath: workDir });
            })
            : undefined}>
          Delete this repository
        </Button>
      </>,
    }]}
    className={className} />;
};


const GitRepoPanel: React.FC<{ gitMeta: Repository["gitMeta"]; }> = function ({ gitMeta }) {
  return <>
    <PropertyView label="Remote URL" title="Remote URL">
      {gitMeta.remote?.url ?? ''}
    </PropertyView>
    <ShareRepoForm repo={gitMeta} />
    <PanelSeparator />
    <PropertyView label="Work dir." title="Working directory">
      {gitMeta.workingCopyPath}
    </PropertyView>
  </>;
};


const PaneronRepoPanel: React.FC<{ paneronMeta: Repository["paneronMeta"]; }> = function ({ paneronMeta }) {
  if (!paneronMeta) {
    return <>Not a Paneron repository.</>;
  } else {
    return <>
      <PropertyView label="Title">
        {paneronMeta.title}
      </PropertyView>
      <PropertyView label="Datasets">
        {Object.keys(paneronMeta?.datasets ?? {}).length}
      </PropertyView>
    </>;
  }
};


export default SelectedRepositorySidebar;
