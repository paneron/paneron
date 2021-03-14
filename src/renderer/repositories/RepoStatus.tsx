/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { throttle } from 'throttle-debounce';
import { IButtonProps, Icon, InputGroup, Spinner } from '@blueprintjs/core';
import { jsx } from '@emotion/core';
import React, { useState } from 'react';
import {
  loadRepository,
  GitRepository,
  repositoryStatusChanged,
  savePassword,
} from 'repositories';
import type { RepoStatus as IRepoStatus } from 'repositories/types';
import { Button } from '../widgets';


const formatStatusOrOperation =
  (txt: string) => txt.
    replace(/[-]/g, ' ').
    replace(/^\w/, (txt) => txt.toUpperCase());


const OP_LABELS = {
  'pulling': 'syncing',
  'pushing': 'syncing',
  'cloning': 'adding',
};


const RepoStatus: React.FC<{ repo: GitRepository }> = function ({ repo }) {
  const repoStatus = loadRepository.renderer!.useValue(
    { workingCopyPath: repo.workingCopyPath },
    { busy: { operation: 'initializing' } });

  const [latestStatus, setLatestStatus] =
    useState<IRepoStatus | null>(null);

  const throttledSetStatus = throttle(300, setLatestStatus, false);

  repositoryStatusChanged.renderer!.
  useEvent(async ({ workingCopyPath, status }) => {
    if (workingCopyPath !== repo.workingCopyPath) {
      return;
    }
    throttledSetStatus(status);
  }, []);

  const status = latestStatus || repoStatus.value;

  let buttonProps: IButtonProps = {};
  let buttonText: string | null;
  let extraWidget: JSX.Element | null = null;

  if (status.busy) {
    switch (status.busy.operation) {
      case 'pulling':
      case 'pushing':
      case 'cloning':
        if (status.busy.networkError) {
          buttonProps.icon = 'offline';
          buttonText = "Network error";
        } else if (status.busy.awaitingPassword) {
          buttonProps.icon = 'key';
          buttonText = null;
          if (repo.remote?.url) {
            extraWidget = <PasswordInput
              workingCopyPath={repo.workingCopyPath}
              remoteURL={repo.remote.url}
              username={repo.remote.username} />;
          } else {
            extraWidget = <Icon icon="error" />;
          }
        } else {
          buttonText = formatStatusOrOperation(OP_LABELS[status.busy.operation]);
          buttonProps.icon = status.busy.operation === 'pushing'
            ? 'cloud-upload'
            : 'cloud-download';
          const progress = status.busy.progress;
          const progressValue = progress
            ? (1 / progress.total * progress.loaded)
            : undefined;
          const phase = progress?.phase;
          const formattedPhase =
            (phase && phase.toLowerCase() !== 'analyzing workdir')
              ? formatStatusOrOperation(phase)
              : null;
          extraWidget = <Button small disabled
              icon={<Spinner
                size={Icon.SIZE_STANDARD}
                value={(progressValue !== undefined && !isNaN(progressValue))
                  ? progressValue
                  : undefined} />}>
            {formattedPhase}
          </Button>;
        }
        break;

      default:
        buttonText = formatStatusOrOperation(status.busy.operation);
        buttonProps.icon = <Spinner size={Icon.SIZE_STANDARD} />;
        break;
    }
  } else {
    buttonText = formatStatusOrOperation(status.status);

    if (status.status === 'invalid-working-copy') {
      buttonProps.icon = 'error';
    } else {
      if (repo.remote) {
        buttonProps.icon = 'tick-circle';
      } else {
        buttonProps.icon = 'offline';
      }
    }
  }

  if (status.status === 'ready') {
    return <></>
  } else {
    return <>
      <Button small disabled {...buttonProps}>{buttonText}</Button>
      {extraWidget}
    </>
  }
};



const PasswordInput: React.FC<{
  workingCopyPath: string
  remoteURL: string
  username: string
}> = function ({ workingCopyPath, remoteURL, username }) {
  const [value, setValue] = useState<string>('');
  const [isBusy, setBusy] = useState(false);

  async function handlePasswordConfirm() {
    setBusy(true);
    try {
      await savePassword.renderer!.trigger({
        workingCopyPath,
        remoteURL,
        username,
        password: value,
      });
    } catch (e) {
      setBusy(false);
    }
  }

  return (
    <InputGroup
      type="password"
      value={value}
      small
      placeholder="Password required"
      disabled={isBusy}
      onChange={(event: React.FormEvent<HTMLElement>) =>
        setValue((event.target as HTMLInputElement).value)}
      rightElement={
        value.trim() === ''
        ? undefined
        : <Button
              minimal={true}
              disabled={isBusy}
              small
              onClick={handlePasswordConfirm}
              icon="tick"
              intent="primary">
            Confirm
          </Button>}
    />
  );
};


export default RepoStatus;
