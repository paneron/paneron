/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx, css } from '@emotion/react';
import { UL } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { ColorNeutralLink } from 'renderer/widgets';
import type { GitAuthor } from 'repositories/types';


const AuthorForm: React.FC<{ author: GitAuthor, onChange?: (newAuthor: GitAuthor) => void }> =
function ({ author, onChange }) {
  return (
    <>
      <PropertyView
          label="Author name"
          tooltip={<>
            The name that will be associated with your commits in VCS.
            {" "}
            Note that for public repositories, this name will be publicly discoverable.
          </>}>
        <TextInput
          onChange={onChange
            ? (val) => onChange({ ...author, name: val })
            : undefined}
          validationErrors={author.name === '' ? ['Please specify author name.'] : []}
          value={author.name}
        />
      </PropertyView>
      <PropertyView
          label="Author email"
          tooltipIntent="warning"
          tooltip={<>
            The email that will be associated with your commits in VCS.
            <UL>
              <li>Note that for public repositories, this email will be publicly discoverable.</li>
              <li>
                For GitHub, you can use the no-reply email in the form of <code css={css`white-space: nowrap;`}>…@users.noreply.github.com</code>
                {" "}
                (see GitHub help’s <ColorNeutralLink href="https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-github-user-account/managing-email-preferences/setting-your-commit-email-address#about-commit-email-addresses">About commit email addresses</ColorNeutralLink>).
              </li>
            </UL>
          </>}>
        <TextInput
          onChange={onChange
            ? (val) => onChange({ ...author, email: val })
            : undefined}
          validationErrors={author.email === '' ? ['Please specify author email.'] : []}
          value={author.email}
        />
      </PropertyView>
    </>
  );
}

export default AuthorForm;
