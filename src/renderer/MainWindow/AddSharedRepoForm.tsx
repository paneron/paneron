/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';

import { jsx } from '@emotion/core';

import React, { useContext, useState } from 'react';

import {
  InputGroup,
  FormGroup,
  Button,
} from '@blueprintjs/core';

import {
  getNewRepoDefaults,
  addRepository,
} from 'repositories/ipc';

import { forceSlug } from 'utils';

import GitCredentialsInput from './GitCredentialsInput';
import { Context } from './context';


const AddSharedRepoForm: React.FC<{
  onCreate: () => void,
  onConfirm?: (opts: { remoteURL: string, username: string, password: string | undefined }) => void,
  className?: string,
}> = function ({ onCreate, onConfirm, className }) {
  const { showMessage } = useContext(Context);
  const [customName, setCustomName] = useState<string | null>(null);
  const [customUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remoteURL, setRemoteURL] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const defaults = getNewRepoDefaults.renderer!.useValue({}, { defaults: { author: { name: '', email: '' } }});

  const remoteComponents = (remoteURL ?? '').split('/');
  const defaultName = remoteComponents[remoteComponents.length - 1];
  const name = customName ?? defaultName;

  const username = customUsername ?? defaults.value.defaults?.remote?.username ?? '';

  const canImport =
    (name ?? '').trim() !== '' &&
    (remoteURL ?? '').trim() !== '' &&
    (username ?? '').trim() !== '';

  async function importRepo() {
    if (!busy && canImport) {
      //onConfirm({ remoteURL: remoteURL!.replace(/\/$/, ''), username, password });
      setBusy(true);
      try {
        addRepository.renderer!.trigger({
          gitRemoteURL: remoteURL!.replace(/\/$/, ''),
          username,
          password: password !== '' ? password : undefined,
        });
        showMessage({ icon: 'tick-circle', intent: 'success', message: "Repository was added and data is being retrieved" });
        setImmediate(() => onCreate());
      } catch (e) {
        log.error("Could not add repository", e);
        showMessage({ icon: 'heart-broken', intent: 'danger', message: "Error importing repository" });
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className={className}>
      <FormGroup
          label="Repository URL:"
          helperText="HTTP(S) URL of remote repository.">
        <InputGroup
          value={remoteURL ?? ''}
          placeholder="https://github.com/some-username/some-repository"
          required
          type="url"
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setRemoteURL(evt.currentTarget.value)
          } />
      </FormGroup>

      <FormGroup
          label="Local name:"
          helperText="This must be unique across all your repositories, and cannot contain spaces or special non-Latin characters. By default, local name is inferred from remote URL.">
        <InputGroup
          fill
          rightElement={
            <Button
              minimal
              disabled={busy || customName === null}
              onClick={() => setCustomName(null)}
              title="Reset to name inferred from remote URL"
              icon="cross" />
          }
          value={name ?? ''}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setCustomName(forceSlug(evt.currentTarget.value))
          } />
      </FormGroup>

      <GitCredentialsInput
        username={username}
        password={password}
        remoteURL={remoteURL ?? ''}
        onEditPassword={setPassword}
        onEditUsername={setUsername}
      />

      <Button
        fill
        disabled={!canImport || busy}
        intent={canImport ? 'success' : undefined}
        onClick={importRepo}>Import</Button>
    </div>
  );
};


export default AddSharedRepoForm;
