/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React from 'react';


interface RepoSettingsProps {
  workDir: string
  onOpenDataset: (datasetID: string) => void 
}

const RepoSettings: React.FC<RepoSettingsProps> =
function ({ workDir, onOpenDataset }) {
  return <p>Repo settings for {workDir}</p>
}


export default RepoSettings;
