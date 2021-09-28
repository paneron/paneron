/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/react';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import React from 'react';
import { GitAuthor } from 'repositories/types';


const AuthorForm: React.FC<{ author: GitAuthor, onChange?: (newAuthor: GitAuthor) => void }> =
function ({ author, onChange }) {
  return (
    <>
      <PropertyView label="Author name">
        <TextInput
          onChange={onChange
            ? (val) => onChange({ ...author, name: val })
            : undefined}
          validationErrors={author.name === '' ? ['Please specify author name.'] : []}
          value={author.name} />
      </PropertyView>
      <PropertyView label="Author email">
        <TextInput
          onChange={onChange
            ? (val) => onChange({ ...author, email: val })
            : undefined}
          validationErrors={author.email === '' ? ['Please specify author email.'] : []}
          value={author.email} />
      </PropertyView>
    </>
  );
}

export default AuthorForm;
