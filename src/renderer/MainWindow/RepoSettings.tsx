/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, css } from '@emotion/core';
import React from 'react';
import { Repository } from 'repositories/types';


interface RepoSettingsProps {
  repo: Repository
  onOpenDataset: (datasetID: string) => void 
}

const RepoSettings: React.FC<RepoSettingsProps> =
function ({ workDir, onOpenDataset }) {
  return (
    <div>
      <div></div>
      <footer></footer>
    </div>
  );
}


const RepoStatusBar: React.FC<> =
function ({ }) {
}


export default RepoSettings;
