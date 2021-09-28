/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useState } from 'react';
import { jsx, css } from '@emotion/react';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PanelSeparator';
import { Button } from 'renderer/widgets';
import { GitAuthor } from 'repositories/types';
import { getNewRepoDefaults } from 'repositories/ipc';
import AuthorForm from '../repositories/AuthorForm';


interface CreateRepoFormProps {
  onCreate?: (repoTitle: string, author: GitAuthor, mainBranchName: string) => void
  className?: string 
}
const CreateRepoForm: React.FC<CreateRepoFormProps> =
function ({ onCreate, className }) {
  const [repoTitle, setRepoTitle] = useState<string>('');

  const defaults = getNewRepoDefaults.renderer!.useValue(
    {},
    { defaults: { author: { name: '', email: '' } }}
  );

  const [customBranch, setBranch] = useState<string | null>(null);
  const [customAuthor, setAuthor] = useState<GitAuthor | null>(null);

  const author: GitAuthor | null = customAuthor ?? defaults.value.defaults?.author ?? null;
  const branchName: string | null = customBranch ?? defaults.value.defaults?.branch ?? null;

  const canCreate = (
    repoTitle.trim() !== '' &&
    author?.name &&
    author?.email &&
    branchName?.trim() &&
    onCreate);

  return (
    <div className={className} css={css`display: flex; flex-flow: column nowrap;`}>
      <PropertyView label="Title">
        <TextInput value={repoTitle} onChange={setRepoTitle} />
      </PropertyView>
      <PanelSeparator />
      <AuthorForm
        author={author ?? { name: '', email: '' }}
        onChange={setAuthor}
      />
      <PanelSeparator />
      <PropertyView label="Main branch">
        <TextInput value={branchName ?? 'main'} onChange={setBranch} />
      </PropertyView>
      <Button
          intent={canCreate ? 'primary' : undefined}
          disabled={!canCreate}
          onClick={canCreate
            ? () => onCreate!(repoTitle, author, branchName!)
            : undefined}>
        Create empty repository
      </Button>
    </div>
  );
}

export default CreateRepoForm;
