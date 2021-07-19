/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import { getNewRepoDefaults, NewRepositoryDefaults, setNewRepoDefaults } from 'repositories/ipc';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { Context } from './context';


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


export const PaneronSettingsSidebar: React.FC<{ className?: string; }> = function ({ className }) {

  return <Sidebar
    stateKey='paneron-settings'
    title="Paneron settings"
    className={className}
    blocks={[{
      key: 'new-repo-defaults',
      title: "Repository defaults",
      content: <NewRepositoryDefaults />,
    }/*, {
      key: 'extensions',
      title: "Installed extensions",
      content: <></>,
    }*/]}
  />;
};


const NewRepositoryDefaults: React.FC<Record<never, never>> = function () {
  const { performOperation, isBusy } = useContext(Context);
  const defaultsResp = getNewRepoDefaults.renderer!.useValue({}, { defaults: null });
  const defaults = defaultsResp.value.defaults;
  const busy = defaultsResp.isUpdating || isBusy;

  const [editedDefaults, setEditedDefaults] = useState<NewRepositoryDefaults | null>(null);

  function editAuthor(author: NewRepositoryDefaults["author"]) {
    setEditedDefaults({ ...maybeEditedDefaults, author });
  }

  function editRemoteUsername(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, remote: { ...maybeEditedDefaults.remote, username: val } });
  }

  function editBranch(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, branch: val });
  }

  const maybeEditedDefaults: NewRepositoryDefaults = { author: { name: '', email: '' }, ...defaults, ...editedDefaults };
  const author = maybeEditedDefaults.author;
  const nameValid = author.name.trim() !== '';
  const emailValid = author.email.trim() !== '';
  const remoteValid = defaults?.remote?.username?.trim() !== ''; // can be undefined by design
  const branchValid = (defaults?.branch ?? '').trim() !== '';
  const defaultsValid = nameValid && emailValid && remoteValid && branchValid;
  const defaultsChanged = editedDefaults && JSON.stringify(editedDefaults) !== JSON.stringify(defaults ?? {});

  return (
    <>
      <PropertyView label="Author name">
        <TextInput
          onChange={!busy ? (val) => editAuthor({ ...author, name: val }) : undefined}
          validationErrors={author.name === '' ? ['Please specify author name.'] : []}
          value={author.name} />
      </PropertyView>
      <PropertyView label="Author email">
        <TextInput
          onChange={!busy ? (val) => editAuthor({ ...author, email: val }) : undefined}
          validationErrors={author.email === '' ? ['Please specify author email.'] : []}
          value={author.email} />
      </PropertyView>
      <PropertyView label="Remote username">
        <TextInput
          onChange={!busy ? (val) => editRemoteUsername(val) : undefined}
          value={maybeEditedDefaults.remote?.username ?? ''} />
      </PropertyView>
      <PropertyView label="Default branch">
        <TextInput
          onChange={!busy ? (val) => editBranch(val) : undefined}
          validationErrors={!branchValid ? ['Please specify a default branch name, e.g. “master” or “main”'] : []}
          value={maybeEditedDefaults.branch ?? ''} />
      </PropertyView>
      <Button
        disabled={busy || !defaultsValid || !defaultsChanged} small fill outlined
        onClick={editedDefaults
          ? performOperation('updating repository defaults', async () => {
              await setNewRepoDefaults.renderer!.trigger(editedDefaults);
              setEditedDefaults(null);
              defaultsResp.refresh();
            })
          : undefined}>
        Update defaults
      </Button>
    </>
  );
};


export default PaneronSettingsSidebar;
