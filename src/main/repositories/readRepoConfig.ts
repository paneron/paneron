// Reading & updating Paneorn repository configuration

import path from 'path';
import fs from 'fs-extra';
import AsyncLock from 'async-lock';
import yaml from 'js-yaml';
import { app } from 'electron';
import log from 'electron-log';
import { PANERON_REPOSITORY_META_FILENAME } from '../../repositories';
import { GitRepository, NewRepositoryDefaults, PaneronRepository } from '../../repositories/types';
import { deserializeMeta } from 'main/meta-serdes';
import { getLoadedRepository } from './loadedRepositories';


const REPO_LIST_FILENAME = 'repositories.yaml';

const REPO_LIST_PATH = path.join(app.getPath('userData'), REPO_LIST_FILENAME);

interface RepoListSpec {
  defaults?: NewRepositoryDefaults;
  workingCopies: {
    [path: string]: Omit<GitRepository, 'workingCopyPath'>;
  };
}

const FileAccessLock = new AsyncLock();

export async function readRepoConfig(workingCopyPath: string): Promise<GitRepository> {
  const cfg: GitRepository | undefined = {
    workingCopyPath,
    ...(await readRepositories()).workingCopies[workingCopyPath]
  };
  if (cfg !== undefined) {
    return cfg;
  } else {
    log.error("Repositories: Cannot find configuration for working copy", workingCopyPath);
    throw new Error("Working copy config not found");
  }
}

export async function readPaneronRepoMeta(workingCopyPath: string): Promise<PaneronRepository> {
  const readerWorker = getLoadedRepository(workingCopyPath).workers.reader;

  const meta = (await readerWorker.repo_getBufferDataset({
    workDir: workingCopyPath,
    paths: [PANERON_REPOSITORY_META_FILENAME],
  }))[PANERON_REPOSITORY_META_FILENAME];

  if (meta === null) {
    throw new Error("Paneron repository metadata file is not found");
  } else {
    return deserializeMeta(meta);
  }
}

export async function readRepositories(): Promise<RepoListSpec> {
  await fs.ensureFile(REPO_LIST_PATH);
  const rawData = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });

  const data = yaml.load(rawData);

  if (data.workingCopies) {
    return (data as RepoListSpec);
  } else {
    return { workingCopies: {} };
  }
}

export async function updateRepositories(updater: (data: RepoListSpec) => RepoListSpec) {
  await FileAccessLock.acquire('1', async () => {
    let data: RepoListSpec;
    try {
      const rawData: any = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
      data = yaml.load(rawData) || { workingCopies: {} };
    } catch (e) {
      data = { workingCopies: {} };
    }

    const newData = updater(data);
    const newRawData = yaml.dump(newData, { noRefs: true });

    await fs.writeFile(REPO_LIST_PATH, newRawData, { encoding: 'utf-8' });
  });
}

export async function _updateNewRepoDefaults(defaults: Partial<NewRepositoryDefaults>) {
  return await updateRepositories((data) => ({
    ...data,
    defaults: {
      ...data.defaults,
      ...defaults,
    },
  }));
}
