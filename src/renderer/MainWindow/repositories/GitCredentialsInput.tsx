/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/react';
import React, { useState } from 'react';
import { Button, ButtonProps, Callout, UL } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { queryGitRemote } from 'repositories/ipc';
import { Popover2 } from '@blueprintjs/popover2';


interface GitCredentialsInputProps {
  username: string
  password: string
  remoteURL: string

  requireBlankRepo?: boolean
  requirePush?: boolean
  requireMainBranchName?: string

  onEditUsername?: (newValue: string) => void
  onEditPassword?: (newValue: string) => void
}
export const GitCredentialsInput: React.FC<GitCredentialsInputProps> =
function ({
  username, password,
  remoteURL,
  requireBlankRepo, requirePush, requireMainBranchName,
  onEditUsername, onEditPassword,
}) {
  const [isBusy, setBusy] = useState(false);
  const [testResult, setTestResult] =
    useState<RepositoryConnectionTestResult | undefined>(undefined);

  const testButtonProps: ButtonProps = {
    disabled: isBusy || remoteURL.trim() === '',
    onClick: handleTest,
  };

  const testPassed = testResult && passed(testResult, requireBlankRepo, requirePush, requireMainBranchName);
  const testResultNotes = testResult
    ? getNotes(testResult, requireBlankRepo, requirePush, requireMainBranchName)
    : null;

  if (testPassed) {
    testButtonProps.intent = 'success';
  } else if (testResult !== undefined) {
    testButtonProps.intent = 'danger';
    testButtonProps.text = "Try again";
    testButtonProps.rightIcon = 'warning-sign';
    testButtonProps.alignText = 'left';
  }

  if (testResult === undefined) {
    testButtonProps.text = "Test connection";
    testButtonProps.alignText = 'center';

  // Test failed
  } else if (!testPassed) {
    testButtonProps.rightIcon = 'warning-sign';

  // Test passed
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
      setTestResult(remote.result);
      setTimeout(() => {
        if (!getNotes(remote.result, requireBlankRepo, requirePush, requireMainBranchName)) {
          setTestResult(undefined);
        }
      }, 5000);
    } catch (e) {
      setTestResult({ error: (e as any)?.toString() ?? 'unknown error' });
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
          onChange={!isBusy && onEditUsername
            ? (val) => onEditUsername!(val.replace(/ /g,'-').replace(/[^\w-]+/g,''))
            : undefined} />
      </PropertyView>
      <PropertyView
          label="Password"
          title="In case of GitHub, your GitHub password (might not work) or Personal Access Token (recommended). \
            Paneron stores your password or PAT using your system’s secret management mechanism, and communicates it only to this remote and only during synchronization.">
        <TextInput
          value={onEditPassword ? password : '•••••••••'}
          inputGroupProps={{ type: 'password', placeholder: 'Password or PAT' }}
          onChange={!isBusy && onEditPassword ? (val) => onEditPassword!(val) : undefined} />
      </PropertyView>
      <ClassNames>
        {({ css, cx }) => (
          <Popover2
              minimal
              fill
              isOpen={testResultNotes !== null}
              popoverClassName={`${css`margin: 10px;`}`}
              content={testResultNotes
                ? <Callout
                      title={testPassed ? "It works, but" : "There may have been an issue"}
                      intent={testPassed ? 'primary' : 'danger'}>
                    {testResultNotes}
                  </Callout>
                : undefined}
              onClose={() => setTestResult(undefined)}>
            <Button
              small
              fill
              outlined
              {...testButtonProps}
              css={css`.bp3-button-text { overflow: hidden; }`}
            />
          </Popover2>
        )}
      </ClassNames>
    </>

  );
}

export default GitCredentialsInput;


type RepositoryConnectionTestResult = {
  isBlank: boolean
  canPush: boolean
  mainBranchName?: string
  error?: undefined
} | {
  isBlank?: undefined
  canPush?: undefined
  mainBranchName?: string
  error: string
}

function passed(
  testResult: RepositoryConnectionTestResult,
  requireBlankRepo?: boolean,
  requirePush?: boolean,
  requireMainBranchName?: string,
): boolean {
  return (
    testResult !== undefined &&
    testResult.error === undefined &&
    (!requireBlankRepo || testResult.isBlank) &&
    (!requirePush || testResult.canPush) &&
    (!requireMainBranchName || testResult.mainBranchName === requireMainBranchName)
  );
}

function getNotes(
  testResult: RepositoryConnectionTestResult,
  requireBlankRepo?: boolean,
  requirePush?: boolean,
  requireMainBranchName?: string,
): JSX.Element | null {
  if (!passed(testResult, requireBlankRepo, requirePush, requireMainBranchName)) {
    return (
      <UL>
        {testResult.error
          ? <>
              <li>
                There was a problem connecting.
                &emsp;
                <small>({testResult.error?.replace("Error: Error invoking remote method 'queryRemote': ", "") ?? "Error message not available."})</small>
              </li>
              <li>
                Please check repository URL and, if applicable, access credentials.
              </li>
              <li>
                Please check your connection.
              </li>
              <li>
                Wait in case repository hosting is experiencing downtime.
              </li>
              <li>
                Otherwise, please contact us and let us know the error message.
              </li>
            </>
          : <>
              {!testResult.isBlank && requireBlankRepo
                ? <li>Repository is not empty</li>
                : null}
              {!testResult.canPush && requirePush
                ? <li>Read-only access</li>
                : null}
              {requireMainBranchName && requireMainBranchName !== testResult.mainBranchName
                ? <li>
                    Main branch name doesn’t match: you entered <code>{requireMainBranchName}</code>, but this repository appears to be using <code>{testResult.mainBranchName}</code>
                  </li>
                : null}
            </>}
      </UL>
    );
  } else if (!testResult.canPush) {
    return (
      <UL>
        <li>
          If you expect to be able to make changes, please make sure that the username and secret are correct
          and your account has the required access provisioned.
        </li>
        <li>
          Otherwise, you can ignore this message.
        </li>
      </UL>
    );
  } else {
    return null;
  }
}
