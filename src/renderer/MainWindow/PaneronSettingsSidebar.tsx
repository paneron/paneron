/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx } from '@emotion/core';

import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import { getNewRepoDefaults, NewRepositoryDefaults, setNewRepoDefaults } from 'repositories/ipc';
import { Context } from './context';
import Sidebar from './Sidebar';
import PropertyView, { TextInput } from './Sidebar/PropertyView';


export const PaneronSettingsSidebar: React.FC<{ className?: string; }> = function ({ className }) {
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

  const maybeEditedDefaults: NewRepositoryDefaults = { author: { name: '', email: '' }, ...defaults, ...editedDefaults };
  const author = maybeEditedDefaults.author;
  const nameValid = author.name.trim() !== '';
  const emailValid = author.email.trim() !== '';
  const remoteValid = defaults?.remote?.username?.trim() !== ''; // can be undefined by design
  const defaultsValid = nameValid && emailValid && remoteValid;
  const defaultsChanged = editedDefaults && JSON.stringify(editedDefaults) !== JSON.stringify(defaults ?? {});

  return <Sidebar
    stateKey='paneron-settings'
    title="Settings"
    className={className}
    blocks={[{
      key: 'new-repo-defaults',
      title: "Repository defaults",
      content: <>
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
      </>,
    }]} />;
};


export default PaneronSettingsSidebar;
