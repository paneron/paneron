/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useState } from 'react';
import { jsx, css } from '@emotion/react';
import { EditableText } from '@blueprintjs/core';

import type { Repository } from 'repositories/types';


const RepositoryLabel: React.FC<{ repo: Repository, onEdit?: (val?: string) => void }> =
function ({ repo, onEdit }) {
  const customLabel = repo.gitMeta.label;
  const officialTitle = repo.paneronMeta?.title;
  const readOnlyView = customLabel && officialTitle
    ? <>{officialTitle} <span css={css`font-weight: normal;`}>({customLabel})</span></>
    : <>{customLabel ?? officialTitle ?? 'N/A'}</>;
  if (!onEdit) {
    return readOnlyView;
  } else {
    return <>
      {officialTitle
        ? <span title={officialTitle}>{officialTitle}&emsp;</span>
        : null}
      <span title="Click to specify custom label"><EditableRepositoryLabel
        css={css`font-weight: normal;`}
        label={customLabel ?? ''}
        onEdit={onEdit}
      /></span>
    </>;
  }
}

const EditableRepositoryLabel: React.FC<{ label: string, onEdit: (val?: string) => void, className?: string }> =
function ({ label, onEdit, className }) {
  const [isEditing, setIsEditing] = useState(false);
  const [_editedValue, setEditedValue] = useState<null | string>(null);
  const editedValue = _editedValue ?? label ?? '';

  return <EditableText
    className={className}
    placeholder={isEditing ? "Enter label…" : "(click to label)"}
    isEditing={isEditing}
    maxLength={100}
    confirmOnEnterKey
    disabled={!onEdit}
    onEdit={() => setIsEditing(true)}
    onCancel={() => setIsEditing(false)}
    onConfirm={() => {
      setIsEditing(false);
      editedValue !== label
        ? onEdit?.(editedValue || undefined)
        : void 0;
    }}
    onChange={setEditedValue}
    value={isEditing ? editedValue : label}
  />;
};

export default RepositoryLabel;
