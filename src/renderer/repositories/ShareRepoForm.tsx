/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import { jsx } from '@emotion/core';
import React, { useState } from 'react';
import { InputGroup, FormGroup, Button, ControlGroup } from '@blueprintjs/core';
import { getNewRepoDefaults, setRemote } from 'repositories';


export const ShareRepoForm: React.FC<{ workingCopyPath: string, onComplete: () => void }> =
function ({ workingCopyPath, onComplete }) {
  const [busy, setBusy] = useState(false);
  const defaults = getNewRepoDefaults.renderer!.useValue({}, {});

  const [_url, setURL] = useState('');
  const [customUsername, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [_error, setError] = useState('');

  const username = (customUsername || defaults.value.remote?.username || '').trim();
  const url = _url.trim();
  const error = _error.trim();

  const canDo =
    (username || '').trim() !== '' &&
    (url || '').trim() !== '';

  async function share() {
    if (!busy && username !== '' && url !== '') {
      setBusy(true);
      try {
        await setRemote.renderer!.trigger({
          workingCopyPath,
          url,
          username,
          password: password !== '' ? password : undefined,
        });
        onComplete();
      } catch (e) {
        log.error("Could not share repository", e);
        setError("Please check that this URL points to an empty repository, your username has push access, password (if needed) is correct, and your Internet connection is online.")
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      <FormGroup
          label="Remote URL:"
          intent={error !== '' ? 'danger' : undefined}
          helperText={<>
            {error !== '' ? error : "HTTP(S) URL of remote repository."}
          </>}>
        <InputGroup
          value={_url}
          placeholder="https://github.com/some-username/some-repository"
          required
          type="url"
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            setURL(evt.currentTarget.value)
          } />
      </FormGroup>

      <FormGroup
          label="Your username and password:"
          helperText="The username you use to access this repository. In case of GitHub, this is your GitHub username.">
        <ControlGroup>
          <InputGroup
            value={username}
            required
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setUsername(evt.currentTarget.value.replace(/ /g,'-').replace(/[^\w-]+/g,''))
            } />
          <InputGroup
            value={password}
            type="password"
            required
            onChange={(evt: React.FormEvent<HTMLInputElement>) =>
              setPassword(evt.currentTarget.value)
            } />
        </ControlGroup>
      </FormGroup>

      <Button
        fill
        disabled={!canDo || busy}
        intent="success"
        onClick={share}>Share</Button>
    </>
  );
};


export default ShareRepoForm;
