/** @jsx jsx */
/** @jsxFrag React.Fragment */

import log from 'electron-log';
import styled from '@emotion/styled';
import { jsx } from '@emotion/core';
import React, { useState, useEffect, useRef } from 'react';
import Mark from 'mark.js';
import { Button as BPButton, Callout, ControlGroup, FormGroup, H4, InputGroup, NonIdealState } from '@blueprintjs/core';
import { setAuthorInfo } from 'repositories';


export const Button = styled(BPButton)`
  white-space: nowrap;

  .bp3-button-text {
    overflow: hidden;
    text-overflow: ellipsis;
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


// TODO: Support suggestions to resolve (move from dataset view)
export const ErrorState: React.FC<{ technicalDetails?: string | JSX.Element, error?: Error, viewName?: string }> =
function ({ technicalDetails, error, viewName }) {
  return (
    <NonIdealState
      icon="heart-broken"
      title="Ouch"
      description={
        <>
          <p>
            Unable to display {viewName || 'view'}.
          </p>
          {technicalDetails || error
            ? <Callout style={{ textAlign: 'left', transform: 'scale(0.9)' }} title="Technical details">
                {technicalDetails}
                {error
                  ? <pre style={{ overflow: 'auto', paddingBottom: '1em' }}>
                      {error?.name || 'Unknown error'}: {error?.message || 'no details provided'}
                    </pre>
                  : null}
              </Callout>
            : null}
        </>
      }
    />
  );
};


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
