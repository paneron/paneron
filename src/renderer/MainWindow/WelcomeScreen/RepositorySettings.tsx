/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';

import React, { useContext } from 'react';
import { Button } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PanelSeparator';
import ShareRepoForm from 'renderer/MainWindow/repositories/ShareRepoForm';
import { deleteRepository, describeRepository, repositoriesChanged, Repository } from 'repositories/ipc';
import { Context } from '../context';


const RepositorySettings: React.FC<{ workDir: string; repoInfo?: Repository; className?: string; }> =
function ({ workDir, repoInfo, className }) {
  const { performOperation, isBusy } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } } });

  repositoriesChanged.renderer!.useEvent(async ({ changedWorkingPaths }) => {
    if ((changedWorkingPaths ?? []).indexOf(workDir) >= 0) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  const openedRepo = openedRepoResp.value.info;

  const repo = openedRepoResp.isUpdating ? (repoInfo ?? openedRepo) : openedRepo;

  const canDelete = !openedRepoResp.isUpdating && !isBusy;

  return (
    <div className={className}>
      <PaneronRepoPanel paneronMeta={repo.paneronMeta} />
      <PanelSeparator />
      <GitRepoPanel gitMeta={repo.gitMeta} />
      <PanelSeparator />
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
    </div>
  );
};


const GitRepoPanel: React.FC<{ gitMeta: Repository["gitMeta"]; }> = function ({ gitMeta }) {
  return <>
    <PropertyView label="Work dir." title="Working directory">
      {gitMeta.workingCopyPath}
    </PropertyView>
    <PanelSeparator />
    <PropertyView label="Remote URL" title="Remote URL">
      <TextInput value={gitMeta.remote?.url ?? ''} />
    </PropertyView>
    <ShareRepoForm repo={gitMeta} />
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


export default RepositorySettings;
