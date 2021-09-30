/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useState } from 'react';
import { jsx, css } from '@emotion/react';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/panels/PanelSeparator';
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
  const defaultBranch = defaults.value.defaults?.branch || 'main';
  const branch: string = customBranch || defaultBranch;

  const canCreate = (
    repoTitle.trim() !== '' &&
    author?.name &&
    author?.email &&
    branch?.trim() &&
    onCreate);

  return (
    <div className={className} css={css`display: flex; flex-flow: column nowrap;`}>
      <PropertyView
          label="Paneron repository title">
        <TextInput value={repoTitle} onChange={setRepoTitle} />
      </PropertyView>
      <PanelSeparator />
      <PropertyView
          label="Git repository main branch name"
          tooltip="This is generally not customized. Typical values are ‘main’ and ‘master’.">
        <TextInput
          value={customBranch ?? ''}
          onChange={setBranch}
          inputGroupProps={{ required: true, type: 'text', placeholder: branch }}
        />
      </PropertyView>
      <PanelSeparator
        title="Authoring information"
        titleStyle={{ alignSelf: 'flex-start' }}
      />
      <AuthorForm
        author={author ?? { name: '', email: '' }}
        onChange={setAuthor}
      />
      <Button
          intent={canCreate ? 'primary' : undefined}
          disabled={!canCreate}
          onClick={canCreate
            ? () => onCreate!(repoTitle, author, branch!)
            : undefined}>
        Create empty repository
      </Button>
    </div>
  );
}

export default CreateRepoForm;
