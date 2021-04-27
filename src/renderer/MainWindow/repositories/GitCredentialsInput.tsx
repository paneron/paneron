/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React, { useState } from 'react';
import { Button, IButtonProps } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { queryGitRemote } from 'repositories/ipc';


interface GitCredentialsInputProps {
  username: string
  password: string
  remoteURL: string

  requireBlankRepo?: boolean
  requirePush?: boolean

  onEditUsername?: (newValue: string) => void
  onEditPassword?: (newValue: string) => void
}
export const GitCredentialsInput: React.FC<GitCredentialsInputProps> =
function ({
  username, password,
  remoteURL,
  requireBlankRepo, requirePush,
  onEditUsername, onEditPassword,
}) {
  type TestResult = {
    isBlank: boolean
    canPush: boolean
    error?: undefined
  } | {
    isBlank?: undefined
    canPush?: undefined
    error: string
  }

  const [isBusy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | undefined>(undefined);

  const canConfirm: boolean = (
    testResult !== undefined &&
    testResult.error === undefined &&
    (!requireBlankRepo || testResult.isBlank) &&
    (!requirePush || testResult.canPush));

  const testButtonProps: IButtonProps = {
    disabled: isBusy,
    onClick: handleTest,
  };

  if (canConfirm) {
    testButtonProps.intent = 'success';
  } else if (testResult !== undefined) {
    testButtonProps.intent = 'danger';
    testButtonProps.rightIcon = 'warning-sign';
    testButtonProps.alignText = 'left';
  }

  if (testResult === undefined) {
    testButtonProps.text = "Test connection";
    testButtonProps.alignText = 'center';

  // Error cases
  } else if (testResult.error) {
    testButtonProps.text = `Failed to connect—please check URL, credentials and connection and click again. ${testResult.error}`;
  } else if (!testResult.isBlank && requireBlankRepo) {
    testButtonProps.text = "Repository is not empty";
  } else if (!testResult.canPush && requirePush) {
    testButtonProps.text = "No write access";

  // Successful cases
  } else {
    if (testResult.canPush) {
      testButtonProps.text = "Write access";
      testButtonProps.rightIcon = 'unlock';
    } else {
      testButtonProps.text = "Read-only access";
      testButtonProps.rightIcon = 'lock';
    }
    if (testResult.isBlank) {
      testButtonProps.text = `${testButtonProps.text}, blank repository`;
    }
  }

  async function handleTest() {
    setBusy(true);
    try {
      const remote = await queryGitRemote.renderer!.trigger({
        url: remoteURL,
        username,
        password: password !== '' ? password : undefined,
      });
      if (remote.result) {
        setTestResult(remote.result);
        setTimeout(() => {
          setTestResult(undefined);
        }, 5000);
      } else {
        setTestResult({ error: remote.errors[0]?.message ?? 'unknown error' });
      }
    } catch (e) {
      setTestResult({ error: e.message ?? 'unknown error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PropertyView label="Username" title="In case of GitHub, use your GitHub username">
        <TextInput
          value={username}
          inputGroupProps={{ required: true }}
          onChange={onEditUsername ? (val) => onEditUsername!(val.replace(/ /g,'-').replace(/[^\w-]+/g,'')) : undefined} />
      </PropertyView>
      <PropertyView
          label="Password"
          title="In case of GitHub, your GitHub password (might not work) or Personal Access Token (recommended). \
            Paneron stores your password or PAT using your system’s secret management mechanism, and communicates it only to this remote and only during synchronization.">
        <TextInput
          value={onEditPassword ? password : '•••••••••'}
          inputGroupProps={{ type: 'password', placeholder: 'Password or PAT' }}
          onChange={onEditPassword ? (val) => onEditPassword!(val) : undefined} />
      </PropertyView>
      <Button small fill outlined {...testButtonProps} css={css`.bp3-button-text { overflow: hidden; }`} />
    </>

  );
}

export default GitCredentialsInput;
