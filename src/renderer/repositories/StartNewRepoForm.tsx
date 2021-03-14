/** @jsx jsx */
/** @jsxFrag React.Fragment */

import path from 'path';
import log from 'electron-log';

import { jsx } from '@emotion/core';

import React, { useState } from 'react';

import {
  InputGroup,
  FormGroup,
  ControlGroup,
} from '@blueprintjs/core';

import {
  createRepository,
  selectWorkingDirectoryContainer,
  getDefaultWorkingDirectoryContainer,
  validateNewWorkingDirectoryPath,
  getNewRepoDefaults,
} from 'repositories';

import { forceSlug } from 'utils';

import { Button } from '../widgets';


const StartNewRepoForm: React.FC<{ onCreate: () => void }> = function ({ onCreate }) {
  const [name, setName] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(null);

  const [customAuthorName, setAuthorName] = useState('');
  const [customAuthorEmail, setAuthorEmail] = useState('');

  const [busy, setBusy] = useState(false);

  const defaults = getNewRepoDefaults.renderer!.useValue({}, {});

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
    (title || '').trim() !== '' &&
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
    if (!busy && workingCopyPath && author && title && workingCopyPathIsAvailable) {
      setBusy(true);
      try {
        await createRepository.renderer!.trigger({
          workingCopyPath,
          author,
          title: title.trim(),
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
      <FormGroup label="Title:">
        <InputGroup
          value={title || ''}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setTitle(evt.currentTarget.value)
          } />
      </FormGroup>

      <FormGroup
          label="Local name:"
          helperText="This must be unique across all your repositories, and cannot contain spaces or special non-Latin characters.">
        <InputGroup
          value={name || ''}
          required
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setName(forceSlug(evt.currentTarget.value))
          } />
      </FormGroup>

      <FormGroup
          labelInfo="(advanced)"
          label="Working directory location:"
          helperText={<>
            Your repository’s working directory will be created <em>inside</em> this folder.
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
