/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useState } from 'react';
import { jsx, css } from '@emotion/react';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { Button } from 'renderer/widgets';


const CreateRepoForm: React.FC<{ onCreate?: (repoTitle: string) => void, className?: string }> =
function ({ onCreate, className }) {
  const [repoTitle, setRepoTitle] = useState<string>('');
  const canCreate = repoTitle.trim() !== '' && onCreate;
  return (
    <div className={className} css={css`display: flex; flex-flow: column nowrap;`}>
      <PropertyView label="Title">
        <TextInput value={repoTitle} onChange={setRepoTitle} />
      </PropertyView>
      <Button
          intent={canCreate ? 'primary' : undefined}
          disabled={!canCreate}
          onClick={canCreate ? () => onCreate!(repoTitle) : undefined}>
        Create empty repository
      </Button>
    </div>
  );
}

export default CreateRepoForm;
