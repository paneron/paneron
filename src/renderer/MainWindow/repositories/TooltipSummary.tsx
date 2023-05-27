/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx } from '@emotion/react';
import styled from '@emotion/styled';
import type { Repository } from 'repositories/types';


const DL = styled.dl`
  margin: 0;
  padding: 0;
  > * {
    display: flex;
    flex-flow: row nowrap;
    > dt {
      font-weight: bold;
      margin-right: .5em;
    }
    > dd {
      margin: 0;
    }
  }
`;


const RepositorySummary: React.FC<{ repo: Repository, className?: string }> =
function ({ repo, className }) {
  return <DL className={className}>
    <div>
      <dt>Working&nbsp;directory</dt>
      <dd><code>{repo.gitMeta.workingCopyPath}</code></dd>
    </div>
    <div>
      <dt>Remote</dt>
      <dd><code>{repo.gitMeta.remote?.url ?? '—'}</code></dd>
    </div>
    <div>
      <dt>Branch</dt>
      <dd><code>{repo.gitMeta.mainBranch}</code></dd>
    </div>
    <div>
      <dt>Authoring&nbsp;as</dt>
      <dd>
        {repo.gitMeta.author
          ? <>{repo.gitMeta.author.name} <code>{repo.gitMeta.author.email}</code></>
          : <>—</>}
      </dd>
    </div>
  </DL>;
};

export default RepositorySummary;
