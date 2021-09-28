/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import styled from '@emotion/styled';
import { jsx } from '@emotion/react';
import React, { useState, useEffect, useRef } from 'react';
import Mark from 'mark.js';
import { Button as BPButton, ControlGroup, FormGroup, H4, InputGroup } from '@blueprintjs/core';
import ErrorState from '@riboseinc/paneron-extension-kit/widgets/ErrorState';

import { setAuthorInfo } from 'repositories/ipc';


export const Button = styled(BPButton)`
  white-space: nowrap;

  .bp3-button-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;


export const ColorNeutralLink = styled.a`
  color: inherit;
  text-decoration: underline;
  text-decoration-style: dotted;
  &:hover {
    color: inherit;
    text-decoration-style: solid;
  }
`;


export const MarkedText: React.FC<{ text: string, term?: string }> =
function ({ text, term }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current && term) {
      const mark = new Mark(ref.current);
      mark.mark(term, {
        accuracy: 'partially',
        separateWordSearch: false,
        caseSensitive: false,
      });
      return function cleanup() {
        mark.unmark();
      }
    }
    return () => void 0;
  }, [text, term]);

  return (
    <span ref={ref}>{text}</span>
  );
};


export const AuthorDetails: React.FC<{ workingCopyPath: string, name?: string, email?: string }> =
function ({ workingCopyPath, name, email }) {
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

  const saveDisabled =
    busy ||
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
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            editName(evt.currentTarget.value)}
          value={editing ? (_name || '') : (name || '—')} />
        <InputGroup
          fill
          title="Author email"
          placeholder="Email"
          disabled={busy || !editing}
          onChange={(evt: React.FormEvent<HTMLInputElement>) =>
            editEmail(evt.currentTarget.value)}
          value={editing ? (_email || '') : (email || '—')} />
        {editing
          ? <>
              <Button
                intent="primary"
                disabled={saveDisabled}
                onClick={handleSaveAuthorInfo}
                icon="tick"
              />
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  editName(undefined);
                  editEmail(undefined);
                }}
                icon="cross"
              />
            </>
          : <Button disabled={busy} onClick={() => setEditing(true)} icon="edit" />}
      </ControlGroup>
    </FormGroup>
  )
}


export class ErrorBoundary extends React.Component<{ viewName?: string }, { error?: string }> {
  constructor(props: { viewName: string }) {
    super(props);
    this.state = { error: undefined };
  }
  componentDidCatch(error: Error, info: any) {
    log.error("Error rendering view", this.props.viewName, error, info);
    this.setState({ error: `${error.name}: ${error.message}` });
  }
  render() {
    if (this.state.error !== undefined) {
      return <ErrorState viewName={this.props.viewName} technicalDetails={this.state.error} />;
    }
    return this.props.children;
  }
}


//export const Button = (props: React.PropsWithChildren<IButtonProps>) => (
//  <BPButton css={css`white-space: nowrap;`} {...props} />
//);
