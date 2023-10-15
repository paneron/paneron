/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React from 'react';
import { jsx } from '@emotion/react';
import styled from '@emotion/styled';
import { compareRemote } from 'repositories/ipc';
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


const RepositorySummary: React.FC<{
  repo: Repository
  className?: string
  localHead?: string
  onReset?: (commit: string) => void
}> = function ({ repo, onReset, className }) {
  const comparisonResult = compareRemote.renderer!.useValue(
    { workingCopyPath: repo.gitMeta.workingCopyPath },
    { remoteHead: '' },
  );
  const localHead = repo.gitMeta.head;
  const remoteHead = comparisonResult.value.remoteHead.trim() || null;
  const commonAncestor = comparisonResult.value.commonAncestor;
  const headsDiffer = repo.gitMeta.remote?.url && remoteHead && localHead && localHead !== remoteHead;

  return <DL className={className}>
    <div>
      <dt>Commit</dt>
      <dd><code>{localHead?.slice(0, 6) ?? 'N/A'}</code>
        {headsDiffer && commonAncestor
          ? <>, common ancestor with remote: {commonAncestor?.slice(0, 6)}
              {onReset
                ? <> <a
                      href="javascript: void 0;"
                      onClick={() => onReset?.(commonAncestor)}
                      title="NOTE: This will discard all local changes">
                    (reset to ancestor)
                  </a></>
                : null}
            </>
          : null}
      </dd>
    </div>
    <div>
      <dt>Remote</dt>
      <dd><code>{repo.gitMeta.remote?.url ?? '—'}</code>
        {remoteHead ? <code title="Remote commit">@{remoteHead}</code> : null}
      </dd>
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
    <div>
      <dt>Working&nbsp;directory</dt>
      <dd><code>{repo.gitMeta.workingCopyPath}</code></dd>
    </div>
  </DL>;
};


export default RepositorySummary;
