/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';

import { jsx } from '@emotion/core';

import React, { useState } from 'react';

import {
  InputGroup,
  FormGroup, ControlGroup, Button, HTMLSelect
} from '@blueprintjs/core';

import {
  createRepository,
  selectWorkingDirectoryContainer,
  getDefaultWorkingDirectoryContainer,
  validateNewWorkingDirectoryPath, listAvailableTypes, getNewRepoDefaults
} from 'repositories';


const StartNewRepoForm: React.FC<{ onCreate: () => void }> = function ({ onCreate }) {
  const [selectedRepoType, selectRepoType] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);

  const [customAuthorName, setAuthorName] = useState('');
  const [customAuthorEmail, setAuthorEmail] = useState('');

  const [busy, setBusy] = useState(false);

  const defaults = getNewRepoDefaults.renderer!.useValue({}, {});

  const newRepoTypes = listAvailableTypes.renderer!.useValue({}, { types: [] }).value.types;
  const pluginID = selectedRepoType || newRepoTypes[0]?.pluginID || null;

  const defaultWorkingDirectoryContainer =
    getDefaultWorkingDirectoryContainer.renderer!.useValue({}, { path: '' });

  const workDir = workingDirectory || defaultWorkingDirectoryContainer.value.path || '';
  const workingCopyPath = path.join(workDir, name || '');

  const workDirCheck =
    validateNewWorkingDirectoryPath.renderer!.useValue({ _path: workingCopyPath }, { available: false });

  const workingCopyPathIsAvailable = workDirCheck.value.available === true;

  const authorName = customAuthorName || defaults.value.author?.name || '';
  const authorEmail = customAuthorEmail || defaults.value.author?.email || '';

  const canCreate =
    (authorName || '').trim() !== '' &&
    (authorEmail || '').trim() !== '' &&
    (name || '').trim() !== '' &&
    (workDir || '').trim() !== '' &&
    pluginID &&
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

  async function create() {
    if (!busy && workingCopyPath && author && pluginID && workingCopyPathIsAvailable) {
      setBusy(true);
      try {
        await createRepository.renderer!.trigger({
          workingCopyPath,
          author,
          pluginID,
        });
        onCreate();
      } catch (e) {
        log.error("Could not create repository", e);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      <FormGroup label="Type of repository:">
        <ControlGroup>
          <HTMLSelect
            options={newRepoTypes.map(type => ({ label: type.title, value: type.pluginID }))}
            onChange={(evt) => {
              selectRepoType(evt.currentTarget.value);
            }}
            value={pluginID || undefined} />
        </ControlGroup>
      </FormGroup>

      <FormGroup
          label="Machine-readable identifier:"
          helperText="Give your repository a name. This cannot contain spaces or special non-Latin characters.">
        <InputGroup
          value={name || ''}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setName(evt.currentTarget.value.
              toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, ''))
          } />
      </FormGroup>

      <FormGroup
          label="Working copy location:"
          helperText={<>Your repository’s working copy folder will be created <em>inside</em> this folder.</>}>
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
          intent={(!name || workingCopyPathIsAvailable) ? undefined : 'danger'}
          helperText={
            (!name || workingCopyPathIsAvailable)
              ? "This is where repository data will reside on this computer."
              : "Path already occupied or not writable!"
          }>
        <ControlGroup>
          <InputGroup
            fill disabled
            value={name ? workingCopyPath : ''} />
          <Button
            disabled={!canCreate || busy}
            intent="success"
            onClick={create}>Initialize</Button>
        </ControlGroup>
      </FormGroup>
    </>
  );
};


export default StartNewRepoForm;
