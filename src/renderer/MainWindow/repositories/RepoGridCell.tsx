/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx } from '@emotion/react';

import React from 'react';
import { Classes } from '@blueprintjs/core';
import { CellProps, LabelledGridIcon } from '@riboseinc/paneron-extension-kit/widgets/Grid';
import { describeRepository } from 'repositories/ipc';


export const RepoGridCell: React.FC<CellProps> = function ({ itemRef, isSelected, onSelect, onOpen, padding }) {
  const workDir = itemRef;

  const description = describeRepository.renderer!.useValue(
    { workingCopyPath: workDir },
    { info: { gitMeta: { workingCopyPath: workDir, mainBranch: '' }, paneronMeta: undefined } });

  return (
    <LabelledGridIcon
        padding={padding}
        entityType={{
          iconProps: { icon: 'git-repo' },
          name: 'repository',
        }}
        isSelected={isSelected}
        onOpen={onOpen}
        onSelect={onSelect ? () => onSelect!(description.value.info) : undefined}
        contentClassName={description.isUpdating ? Classes.SKELETON : undefined}>
      {description.value.info.paneronMeta?.title ?? '(title not available)'}
    </LabelledGridIcon>
  );
};


export default RepoGridCell;
