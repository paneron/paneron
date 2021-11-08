/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import React, { useState } from 'react';
import { ControlGroup, FormGroup, H4, InputGroup } from '@blueprintjs/core';
import { setAuthorInfo } from 'repositories/ipc';
import { Button } from '../../widgets';


const AuthorDetails: React.FC<{ workingCopyPath: string; name?: string; email?: string; }> = function ({ workingCopyPath, name, email }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedName, editName] = useState<undefined | string>(undefined);
  const [editedEmail, editEmail] = useState<undefined | string>(undefined);

  const _name = editedName || name;
  const _email = editedEmail || email;

  async function handleSaveAuthorInfo() {
    if (_email && _name) {
      setBusy(true);
      setEditing(false);
      try {
        await setAuthorInfo.renderer!.trigger({
          workingCopyPath,
          author: { name: _name, email: _email },
        });
      } catch (e) {
        setEditing(true);
      } finally {
        setBusy(false);
      }
    }
  }

  const saveDisabled = busy ||
    (_name === undefined && _email === undefined) ||
    (_name === name && _email === email);

  return (
    <FormGroup
      label={<H4>Authoring</H4>}
      helperText="Authorship information will be associated with changes you make.">
      <ControlGroup>
        <InputGroup
          fill
          title="Author name"
          placeholder="Name"
          disabled={busy || !editing}
          onChange={(evt: React.FormEvent<HTMLInputElement>) => editName(evt.currentTarget.value)}
          value={editing ? (_name || '') : (name || '—')} />
        <InputGroup
          fill
          title="Author email"
          placeholder="Email"
          disabled={busy || !editing}
          onChange={(evt: React.FormEvent<HTMLInputElement>) => editEmail(evt.currentTarget.value)}
          value={editing ? (_email || '') : (email || '—')} />
        {editing
          ? <>
            <Button
              intent="primary"
              disabled={saveDisabled}
              onClick={handleSaveAuthorInfo}
              icon="tick" />
            <Button
              disabled={busy}
              onClick={() => {
                setEditing(false);
                editName(undefined);
                editEmail(undefined);
              }}
              icon="cross" />
          </>
          : <Button disabled={busy} onClick={() => setEditing(true)} icon="edit" />}
      </ControlGroup>
    </FormGroup>
  );
};


export default AuthorDetails;
