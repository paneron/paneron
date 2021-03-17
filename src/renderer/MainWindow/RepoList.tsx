/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx } from '@emotion/core';
import React from 'react';
import { Repository, RepositoryListQuery } from 'repositories/ipc';


interface RepoListProps {
  repositories: Repository[]
  query: RepositoryListQuery
  onOpenRepo: (datasetID: string) => void 
  onQueryChange: (newQuery: RepositoryListQuery) => void
}

const RepoList: React.FC<RepoListProps> =
function ({ repositories, query, onOpenRepo, onQueryChange }) {
  return <p>Repository list</p>;
}


export default RepoList;
