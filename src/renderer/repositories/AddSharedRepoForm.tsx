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
} from 'repositories';


const AddSharedRepoForm: React.FC<{ onCreate: () => void }> = function ({ onCreate }) {
  const [customUsername, setUsername] = useState<string | null>(null);
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
  const workingCopyPath = path.join(workDir, remoteComponents[remoteComponents.length - 1] || '');

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
        });
        setImmediate(onCreate);
      } catch (e) {
        log.error("Could not clone repository", e);
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
          label="Your username:"
          helperText="The username you use to access this repository. In case of GitHub, this is your GitHub username.">
        <InputGroup
          value={username || ''}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setUsername(evt.currentTarget.value.replace(/ /g,'-').replace(/[^\w-]+/g,''))
          } />
      </FormGroup>

      <FormGroup
          label="Working copy location:"
          helperText={<>Folder of your working copy of this repository will be created <em>inside</em> this folder.</>}>
        <ControlGroup>
          <InputGroup fill readOnly value={workDir || ''} />
          <Button
            disabled={busy || workDir.trim() === ''}
            onClick={selectWorkingDirectory}
            title="Change working copy location"
            icon="folder-open" />
        </ControlGroup>
      </FormGroup>

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
          label="Working copy path:"
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
