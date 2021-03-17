/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';

import { jsx } from '@emotion/core';

import React, { useState } from 'react';

import {
  InputGroup,
  FormGroup, ControlGroup, Button
} from '@blueprintjs/core';

import {
  selectWorkingDirectoryContainer,
  getDefaultWorkingDirectoryContainer,
  validateNewWorkingDirectoryPath, getNewRepoDefaults, addRepository
} from 'repositories/ipc';

import { forceSlug } from 'utils';

import GitCredentialsInput from './GitCredentialsInput';


const AddSharedRepoForm: React.FC<{ onCreate: (workingCopyPath: string) => void }> = function ({ onCreate }) {
  const [customName, setCustomName] = useState<string | null>(null);
  const [customUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remoteURL, setRemoteURL] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);

  const [customAuthorName, setAuthorName] = useState('');
  const [customAuthorEmail, setAuthorEmail] = useState('');

  const [busy, setBusy] = useState(false);

  const defaults = getNewRepoDefaults.renderer!.useValue({}, {});

  const defaultWorkingDirectoryContainer =
    getDefaultWorkingDirectoryContainer.renderer!.useValue({}, { path: '' });

  const workDir = workingDirectory || defaultWorkingDirectoryContainer.value.path || '';
  const remoteComponents = (remoteURL || '').split('/');
  const defaultName = remoteComponents[remoteComponents.length - 1];
  const name = customName ?? defaultName;
  const workingCopyPath = path.join(workDir, name);

  const workDirCheck =
    validateNewWorkingDirectoryPath.renderer!.useValue({ _path: workingCopyPath }, { available: false });

  const workingCopyPathIsAvailable = workDirCheck.value.available === true;

  const authorName = customAuthorName || defaults.value.author?.name || '';
  const authorEmail = customAuthorEmail || defaults.value.author?.email || '';
  const username = customUsername || defaults.value.remote?.username || '';

  const canCreate =
    (authorName || '').trim() !== '' &&
    (authorEmail || '').trim() !== '' &&
    (workDir || '').trim() !== '' &&
    (remoteURL || '').trim() !== '' &&
    (username || '').trim() !== '' &&
    workingCopyPathIsAvailable;

  const author = {
    name: authorName.trim(),
    email: authorEmail.trim(),
  };

  async function selectWorkingDirectory() {
    if (!workDir) { return; }

    setBusy(true);
    try {
      setWorkingDirectory((await selectWorkingDirectoryContainer.renderer!.trigger({ _default: workDir })).result?.path || null);
    } catch (e) {
      setWorkingDirectory(null);
    } finally {
      setBusy(false);
    }
  }

  async function clone() {
    if (!busy && workingCopyPath && workingCopyPathIsAvailable && author && remoteURL && username) {
      setBusy(true);
      try {
        addRepository.renderer!.trigger({
          workingCopyPath,
          author,
          gitRemoteURL: remoteURL.replace(/\/$/, ''),
          username,
          password: password !== '' ? password : undefined,
        });
        setImmediate(() => onCreate(workingCopyPath));
      } catch (e) {
        log.error("Could not start cloning repository", e);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      <FormGroup
          label="Repository URL:"
          helperText="HTTP(S) URL of remote repository.">
        <InputGroup
          value={remoteURL || ''}
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
        <ControlGroup fill>
          <InputGroup
            value={name || ''}
            required
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setCustomName(forceSlug(evt.currentTarget.value))
            } />
          <Button
            disabled={busy || customName === null}
            onClick={() => setCustomName(null)}
            title="Reset to name inferred from remote URL"
            icon="cross" />
        </ControlGroup>
      </FormGroup>

      <GitCredentialsInput
        username={username}
        password={password}
        remoteURL={remoteURL || ''}
        onEditPassword={setPassword}
        onEditUsername={setUsername}
      />

      <FormGroup
          label="Authorship:"
          helperText="Name and email you provide will be associated with edits you make.">
        <ControlGroup fill>
          <InputGroup
            value={authorName || ''}
            placeholder="Name"
            required
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setAuthorName(evt.currentTarget.value)
            } />
          <InputGroup
            value={authorEmail || ''}
            type="email"
            placeholder="Email"
            required
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setAuthorEmail(evt.currentTarget.value)
            } />
        </ControlGroup>
      </FormGroup>

      <FormGroup
          label="Working copy location:"
          helperText={<>
            Folder of your working copy of this repository will be created <em>inside</em> this folder.
            It is recommended to not change this and use the default value, so that all your repositories are in the same place.
          </>}>
        <ControlGroup>
          <InputGroup fill readOnly value={workDir || ''} />
          <Button
            disabled={busy || workDir.trim() === ''}
            onClick={selectWorkingDirectory}
            title="Customize working directory location for this repository"
            icon="folder-open" />
          <Button
            disabled={busy || workingDirectory === null}
            onClick={() => setWorkingDirectory(null)}
            title="Reset to default value"
            icon="cross" />
        </ControlGroup>
      </FormGroup>

      <FormGroup
          label="Calculated full working copy path:"
          intent={(!remoteURL || workingCopyPathIsAvailable) ? undefined : 'danger'}
          helperText={
            (!remoteURL || workingCopyPathIsAvailable)
              ? "This is where repository data will reside on this computer."
              : "Path already occupied or not writable!"
          }>
        <ControlGroup>
          <InputGroup
            fill disabled
            value={remoteURL ? workingCopyPath : ''} />
          <Button
            disabled={!canCreate || busy}
            intent="success"
            onClick={clone}>Add</Button>
        </ControlGroup>
      </FormGroup>
    </>
  );
};


export default AddSharedRepoForm;
