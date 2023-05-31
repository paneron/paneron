/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useState } from 'react';
import { jsx } from '@emotion/react';
import { EditableText } from '@blueprintjs/core';

import type { Repository } from 'repositories/types';


const RepositoryLabel: React.FC<{ repo: Repository, onEdit?: (val?: string) => void }> =
function ({ repo, onEdit }) {
  const customLabel = repo.gitMeta.label;
  const officialTitle = repo.paneronMeta?.title;
  const effectiveValue = customLabel && officialTitle
    ? `${customLabel} • ${officialTitle}`
    : (customLabel ?? officialTitle ?? 'N/A');
  const [isEditing, setIsEditing] = useState(false);
  const [_editedValue, setEditedValue] = useState<null | string>(null);
  const editedValue = _editedValue ?? repo.gitMeta.label ?? '';
  return <EditableText
    placeholder="Custom repository label…"
    isEditing={isEditing}
    maxLength={100}
    confirmOnEnterKey
    disabled={!onEdit}
    onEdit={() => setIsEditing(true)}
    onCancel={() => setIsEditing(false)}
    onConfirm={() => {
      setIsEditing(false);
      editedValue !== customLabel
        ? onEdit?.(editedValue || undefined)
        : void 0;
    }}
    onChange={setEditedValue}
    value={isEditing ? editedValue : effectiveValue}
  />;
}

export default RepositoryLabel;
