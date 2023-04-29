/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import PropertyView from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/panels/PanelSeparator';

import ShareRepoForm from 'renderer/MainWindow/repositories/ShareRepoForm';
import { deleteRepository, describeRepository, repositoriesChanged, setAuthorInfo } from 'repositories/ipc';
import type { Repository } from 'repositories/types';
import type { GitAuthor } from 'repositories/types';
import { Context } from '../context';
import AuthorForm from '../repositories/AuthorForm';


const RepositorySettings: React.FC<{ workDir: string; repoInfo?: Repository; className?: string; }> =
function ({ workDir, repoInfo, className }) {
  const { performOperation, isBusy } = useContext(Context);

  const openedRepoResp = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' } }, isLoaded: false });

  repositoriesChanged.renderer!.useEvent(async ({ changedWorkingPaths }) => {
    if ((changedWorkingPaths ?? []).indexOf(workDir) >= 0) {
      openedRepoResp.refresh();
    }
  }, [workDir]);

  async function handleChangeAuthor(newAuthor: GitAuthor) {
    if (newAuthor?.name && newAuthor?.email && !isBusy) {
      await setAuthorInfo.renderer!.trigger({
        workingCopyPath: workDir,
        author: newAuthor,
      });
    }
  }

  const openedRepo = openedRepoResp.value.info;

  const repo = openedRepoResp.isUpdating ? (repoInfo ?? openedRepo) : openedRepo;

  const canDelete = !openedRepoResp.isUpdating && !isBusy;

  return (
    <div className={className}>
      <PaneronRepoPanel paneronMeta={repo.paneronMeta} />
      <PanelSeparator />
      <GitRepoPanel
        gitMeta={repo.gitMeta}
        onChangeAuthor={!isBusy
          ? performOperation('updating authoring information for this repository', handleChangeAuthor)
          : undefined}
      />
      <PanelSeparator />
      <Button small fill minimal
        disabled={!canDelete}
        intent={canDelete ? 'danger' : undefined}
        onClick={canDelete
          ? performOperation('deleting working copy', async () => {
              await deleteRepository.renderer!.trigger({ workingCopyPath: workDir });
            })
          : undefined}>
        Delete working copy
      </Button>
    </div>
  );
};


const GitRepoPanel: React.FC<{
  gitMeta: Repository["gitMeta"];
  onChangeAuthor?: (newAuthor: GitAuthor) => Promise<void> | void;
}> = function ({ gitMeta, onChangeAuthor }) {
  const [newAuthor, setNewAuthor] = useState<GitAuthor | null>(null);

  const canSave = (
    newAuthor &&
    JSON.stringify(newAuthor) !== JSON.stringify(gitMeta.author ?? {}) &&
    onChangeAuthor);

  async function handleChangeAuthor() {
    if (canSave) {
      try {
        await onChangeAuthor!(newAuthor!);
      } finally {
        setNewAuthor(null);
      }
    }
  }

  const author: GitAuthor | null = newAuthor ?? gitMeta.author ?? null;

  return <>
    <PropertyView label="Work dir." title="Working directory">
      {gitMeta.workingCopyPath}
    </PropertyView>
    <PropertyView label="Branch name" title="Branch name">
      {gitMeta.mainBranch ?? '—'}
    </PropertyView>
    <PanelSeparator />
    <AuthorForm
      author={author ?? { name: '', email: '' }}
      onChange={onChangeAuthor ? setNewAuthor : undefined}
    />
    <Button
        small fill minimal
        disabled={!canSave}
        onClick={handleChangeAuthor}>
      Update author information
    </Button>
    <PanelSeparator />
    <PropertyView label="Remote URL" title="Remote URL">
      {gitMeta.remote?.url ?? '—'}
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
