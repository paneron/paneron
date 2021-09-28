/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { css, jsx } from '@emotion/react';
import React, { useContext, useState } from 'react';
import { ButtonGroup } from '@blueprintjs/core';
import { getNewRepoDefaults, GitRepository, savePassword, setRemote, unsetRemote, unsetWriteAccess } from 'repositories/ipc';
import { Button } from '../../widgets';
import GitCredentialsInput from './GitCredentialsInput';
import { Context } from '../context';


export const ShareRepoForm: React.FC<{ repo: GitRepository }> =
function ({ repo }) {
  const { performOperation, isBusy } = useContext(Context);
  const defaults = getNewRepoDefaults.renderer!.useValue({}, { defaults: { author: { name: '', email: '' } } });

  const [_url] = useState('');
  const [customUsername, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [editingPassword, setEditingPassword] = useState(false);

  const username = ((customUsername || repo.remote?.username) ?? defaults.value.defaults?.remote?.username ?? '').trim();
  const url = _url.trim() || repo.remote?.url?.trim() || '';

  const hasRemote = repo.remote !== undefined;

  const canShare =
    hasRemote === false &&
    !isBusy &&
    (username ?? '').trim() !== '' &&
    (password ?? '') !== '' &&
    (url ?? '').trim() !== '';

  const canUnshare = hasRemote === true && !isBusy;

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
      await unsetWriteAccess.renderer!.trigger({
        workingCopyPath: repo.workingCopyPath,
      });
    }
  }

  async function share() { if (canShare) {
      try {
        await setRemote.renderer!.trigger({
          workingCopyPath: repo.workingCopyPath,
          url,
          username,
          password,
        });
      } catch (e) {
        throw new Error("Please check that this URL points to an empty repository, your username has push access, password (if needed) is correct, and your Internet connection is online.");
      }
    }
  }

  async function unshare() {
    if (canUnshare) {
      await unsetRemote.renderer!.trigger({
        workingCopyPath: repo.workingCopyPath,
      });
    }
  }

  return (
    <>
      <ButtonGroup vertical fill css={css`margin-bottom: 5px; height: unset !important;`}>
        {hasRemote && repo.remote?.writeAccess === true
          ? <Button small outlined
                onClick={performOperation('turning off push', turnOffPush)}>
              Stop relaying changes
            </Button>
          : null}

        {hasRemote
          ? <Button small outlined
                disabled={isBusy || !canUnshare}
                title="Before turning off either relaying changes or sync, make sure you don’t have any outstanding changes \
                  The only way to re-enable relaying your changes for now is by removing and re-adding the repository anew. \
                  If you turn off sync, you will remain being able to make changes, but those changes will stay on this computer.
                  Disabling sync will also turn off relaying changes."
                onClick={performOperation('turning off sync and unsetting remote', unshare)}>
              Clear remote &amp; stop sync
            </Button>
          : <Button small outlined
                disabled={isBusy || !canShare}
                title="To start sharing, configure empty repository URL and access credentials below."
                onClick={performOperation('starting sync with remote', share)}>
              Connect remote &amp; start sync
            </Button>}

        {hasRemote
          ? <Button fill small outlined disabled={isBusy} active={editingPassword} onClick={() => setEditingPassword(true)}>
              Amend password or access token
            </Button>
          : null}

        {hasRemote && editingPassword
          ? <>
              <Button small fill outlined disabled={isBusy || password === ''} onClick={performOperation('updating password', _savePassword)}>
                Save password or token
              </Button>
              <Button small fill outlined disabled={isBusy} onClick={() => { setEditingPassword(false); setPassword(''); }}>
                Don’t save
              </Button>
            </>
          : null}
      </ButtonGroup>

      <GitCredentialsInput
        username={username}
        password={password}
        remoteURL={url || ''}
        requireMainBranchName={repo.mainBranch}
        onEditPassword={!isBusy && (!hasRemote || editingPassword) ? setPassword : undefined}
        onEditUsername={!isBusy && !hasRemote ? setUsername : undefined}
        requireBlankRepo={!hasRemote}
        requirePush
      />
    </>
  );
};


export default ShareRepoForm;
