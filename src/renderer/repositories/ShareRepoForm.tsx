/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { css, jsx } from '@emotion/core';
import React, { useState } from 'react';
import { InputGroup, FormGroup, Switch, H4, ButtonGroup } from '@blueprintjs/core';
import { getNewRepoDefaults, GitRepository, savePassword, setRemote, unsetRemote, unsetWriteAccess } from 'repositories/ipc';
import GitCredentialsInput from '../MainWindow/GitCredentialsInput';
import { Button } from '../widgets';


export const ShareRepoForm: React.FC<{ repo: GitRepository }> =
function ({ repo }) {
  const [busy, setBusy] = useState(false);
  const defaults = getNewRepoDefaults.renderer!.useValue({}, { defaults: { author: { name: '', email: '' } } });

  const [_url, setURL] = useState('');
  const [customUsername, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [_error, setError] = useState('');

  const [editingPassword, setEditingPassword] = useState(false);

  const username = (customUsername ?? repo.remote?.username ?? defaults.value.defaults?.remote?.username ?? '').trim();
  const url = _url.trim() ?? repo.remote?.url?.trim() ?? '';
  const error = _error.trim();

  const hasRemote = repo.remote !== undefined;

  const canShare =
    hasRemote === false &&
    !busy &&
    (username ?? '').trim() !== '' &&
    (password ?? '') !== '' &&
    (url ?? '').trim() !== '';

  const canUnshare = hasRemote === true && !busy;

  async function performOperation(op: () => Promise<void>) {
    setBusy(true);
    try {
      await op();
    } finally {
      setBusy(false);
    }
  }

  async function _savePassword() {
    if (hasRemote && (password ?? '') !== '') {
      await savePassword.renderer!.trigger({
        workingCopyPath: repo.workingCopyPath,
        remoteURL: url,
        username: username,
        password,
      });
      setEditingPassword(false);
      setPassword('');
    }
  }

  async function turnOffPush() {
    if (repo.remote?.writeAccess) {
      try {
        await unsetWriteAccess.renderer!.trigger({
          workingCopyPath: repo.workingCopyPath,
        });
      } catch (e) {
        log.error("Could not turn off relaying changes", e);
        setError(`Failed to disable relaying changes: ${e.message}`);
      }
    }
  }

  async function share() {
    if (canShare) {
      try {
        await setRemote.renderer!.trigger({
          workingCopyPath: repo.workingCopyPath,
          url,
          username,
          password,
        });
      } catch (e) {
        log.error("Could not share repository", e);
        setError("Please check that this URL points to an empty repository, your username has push access, password (if needed) is correct, and your Internet connection is online.");
      }
    }
  }

  async function unshare() {
    if (canUnshare) {
      try {
        await unsetRemote.renderer!.trigger({
          workingCopyPath: repo.workingCopyPath,
        });
      } catch (e) {
        log.error("Could not unshare repository", e);
        setError(`Unexpected error removing remote: ${e.message}`);
      }
    }
  }

  return (
    <>
      <FormGroup
        helperText={!hasRemote
          ? <>To start sharing, configure empty repository URL and access credentials below.</>
          : repo.remote?.writeAccess !== true
            ? <>Disable sync if you want to be able to make changes; but note that changes you make will not be synchronized upstream.</>
            : <>
                <p>
                  IMPORTANT: Before turning off either relaying changes or sync, make sure you don’t have any outstanding changes:
                  {" "}
                  <strong>the only way to re-enable relaying your changes will be by removing and re-adding the repository anew.</strong>
                </p>
                <p css={css`margin-bottom: 0;`}>
                  If you turn off sync, you will remain being able to make changes, but those changes will stay on this computer.
                  Disabling sync will also turn off relaying changes.
                </p>
              </>}
        css={css`
          & .bp3-switch { margin: 0; }
        `}
        label={
          <H4 css={css`margin: 0;`}>
            <Switch
              checked={busy ? undefined : hasRemote}
              disabled={!canShare && !canUnshare}
              label="Collaboration and sync"
              onChange={() => {
                if (hasRemote) {
                  performOperation(unshare);
                } else {
                  performOperation(share);
                }
              }}
            />
          </H4>
        }
      />

      {hasRemote
        ? <FormGroup
            helperText={repo.remote?.writeAccess === true
              ? <>
                  <p>
                    When disabled, you will continue to receive updates but won’t be able to make changes to any dataset within this repository.
                  </p>
                  <p>
                    Turn off in case you no longer manage/own this repository.
                  </p>
                </>
              : <>
                  <p>To enable, please delete and re-add this repository specifying credentials that grant you write (push) access to it.</p>
                </>}>
            <Switch
              checked={busy ? undefined : repo.remote?.writeAccess === true}
              disabled={repo.remote?.writeAccess !== true}
              label="Relay my changes"
              onChange={() => performOperation(turnOffPush)}
            />
          </FormGroup>
        : null}

      <FormGroup
          label="Remote URL:"
          intent={error !== '' ? 'danger' : undefined}
          helperText={<>
            {error !== ''
              ? error
              : hasRemote
                ? "HTTPS URL of the remote repository."
                : "HTTPS URL of an empty remote repository."}
          </>}>
        <InputGroup
          value={url}
          placeholder="E.g., https://github.com/some-username/some-repository"
          required
          type="url"
          disabled={hasRemote || busy}
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setURL(evt.currentTarget.value)
          } />
      </FormGroup>

      <GitCredentialsInput
        username={username}
        password={password}
        remoteURL={url || ''}
        onEditPassword={!busy && (!hasRemote || editingPassword) ? setPassword : undefined}
        onEditUsername={!busy && !hasRemote ? setUsername : undefined}
        requireBlankRepo={!hasRemote}
        requirePush
      />

      {hasRemote
        ? editingPassword
          ? <ButtonGroup fill>
              <Button fill disabled={busy} onClick={() => { setEditingPassword(false); setPassword(''); }}>
                Don’t save
              </Button>
              <Button fill disabled={busy || password === ''} onClick={() => performOperation(_savePassword)}>
                Save password or token
              </Button>
            </ButtonGroup>
          : <Button fill disabled={busy} onClick={() => setEditingPassword(true)}>Correct password or access token</Button>
        : null}
    </>
  );
};


export default ShareRepoForm;
