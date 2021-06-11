/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { addRepository, getNewRepoDefaults } from 'repositories/ipc';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { Context } from '../context';
import GitCredentialsInput from './GitCredentialsInput';


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


export const ImportRepositorySidebar: React.FC<{ className?: string; onCreate: (workDir: string) => void }> =
function ({ className, onCreate }) {
  const { performOperation, isBusy } = useContext(Context);
  const [customUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remoteURL, setRemoteURL] = useState<string | null>(null);

  const defaults = getNewRepoDefaults.renderer!.useValue({}, { defaults: { author: { name: '', email: '' } }});

  const remoteComponents = (remoteURL ?? '').split('/');
  const defaultName = remoteComponents[remoteComponents.length - 1];
  const name = defaultName;

  const username = customUsername ?? defaults.value.defaults?.remote?.username ?? '';

  const canImport =
    !isBusy &&
    (name ?? '').trim() !== '' &&
    (remoteURL ?? '').trim() !== '' &&
    (username ?? '').trim() !== '';

  return (
    <Sidebar
      stateKey='import-shared'
      title="Import shared repository" blocks={[{
        key: 'remote',
        title: "Remote",
        nonCollapsible: true,
        content: <>
          <PropertyView label="Remote URL">
            <TextInput
              value={remoteURL ?? ''}
              inputGroupProps={{ required: true, type: 'url', placeholder: "https://github.com/some-username/some-repository" }}
              onChange={!isBusy ? (val) => setRemoteURL(val) : undefined}
            />
          </PropertyView>
        </>,
      }, {
        key: 'credentials',
        title: "Access credentials",
        nonCollapsible: true,
        content: 
          <GitCredentialsInput
            username={username}
            password={password}
            remoteURL={remoteURL ?? ''}
            onEditPassword={!isBusy ? setPassword : undefined}
            onEditUsername={!isBusy ? setUsername : undefined}
          />,
      }, {
        key: 'import',
        title: "Import",
        nonCollapsible: true,
        content:
          <Button small fill minimal
              disabled={!canImport}
              onClick={canImport
                ? performOperation('adding shared repository', async () => {
                    const resp = await addRepository.renderer!.trigger({
                      gitRemoteURL: remoteURL!.replace(/\/$/, ''),
                      username,
                      password: password !== '' ? password : undefined,
                    });
                    if (resp.result?.workDir) {
                      onCreate(resp.result.workDir);
                    } else {
                      throw new Error("Seems successful, but did not return working directory")
                    }
                  })
                : undefined}>
            Import
          </Button>,
      }]}
      className={className}
    />
  );
}


export default ImportRepositorySidebar;
