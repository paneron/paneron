/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { addRepository, loadRepository, getNewRepoDefaults } from 'repositories/ipc';
import { Context } from '../context';
import GitCredentialsInput from '../repositories/GitCredentialsInput';


const AddSharedRepository: React.FC<{ className?: string; onAfterCreate?: (workDir: string) => void }> =
function ({ className, onAfterCreate }) {
  const { performOperation, isBusy } = useContext(Context);
  const [customUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remoteURL, setRemoteURL] = useState<string | null>(null);

  const [customBranch, setBranch] = useState<string | null>(null);

  const defaults = getNewRepoDefaults.renderer!.useValue(
    {},
    { defaults: { author: { name: '', email: '' } }}
  );

  const remoteComponents = (remoteURL ?? '').split('/');
  const defaultName = remoteComponents[remoteComponents.length - 1];
  const name = defaultName;

  const username = customUsername ?? defaults.value.defaults?.remote?.username ?? '';
  const branch = customBranch ?? defaults.value.defaults?.branch ?? '';

  const canImport =
    !isBusy &&
    (name ?? '').trim() !== '' &&
    (remoteURL ?? '').trim() !== '' &&
    (username ?? '').trim() !== '' &&
    (branch ?? '').trim() !== '';

  return (
    <div className={className}>
      <PropertyView label="Remote URL">
        <TextInput
          value={remoteURL ?? ''}
          inputGroupProps={{
            required: true,
            type: 'url',
            placeholder: "https://github.com/some-username/some-repository",
          }}
          onChange={!isBusy ? (val) => setRemoteURL(val) : undefined}
        />
      </PropertyView>
      <PropertyView label="Branch">
        <TextInput
          value={branch ?? ''}
          inputGroupProps={{ required: true, type: 'text', placeholder: "main" }}
          onChange={!isBusy ? (val) => setBranch(val) : undefined}
        />
      </PropertyView>
      <GitCredentialsInput
        username={username}
        password={password}
        remoteURL={remoteURL ?? ''}
        requireMainBranchName={branch}
        onEditPassword={!isBusy ? setPassword : undefined}
        onEditUsername={!isBusy ? setUsername : undefined}
      />
      <Button
          fill
          css={css`margin-top: 5px;`}
          intent={canImport ? 'primary' : undefined}
          disabled={!canImport}
          onClick={canImport
            ? performOperation('adding shared repository', async () => {
                const resp = await addRepository.renderer!.trigger({
                  gitRemoteURL: remoteURL!.replace(/\/$/, ''),
                  username,
                  password: password !== '' ? password : undefined,
                  branch,
                });
                if (resp.result?.workDir) {
                  await loadRepository.renderer!.trigger({ workingCopyPath: resp.result.workDir });
                  onAfterCreate?.(resp.result.workDir);
                } else {
                  throw new Error("Seems successful, but did not return working directory");
                }
              })
            : undefined}>
        Import
      </Button>
    </div>
  )
}

export default AddSharedRepository;
