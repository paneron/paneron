// Reading & updating Paneorn repository configuration

import path from 'path';
import fs from 'fs-extra';
import AsyncLock from 'async-lock';
import yaml from '@riboseinc/paneron-extension-kit/object-specs/yaml';
import { app } from 'electron';
import log from 'electron-log';
import { normalizeDatasetDir } from '../../datasets/main/loadedDatasets';
import { DatasetInfo } from '../../datasets/types';
import { deserializeMeta } from '../../main/meta-serdes';
import { PANERON_REPOSITORY_META_FILENAME } from '../ipc';
import { GitRepository, NewRepositoryDefaults, PaneronRepository } from '../types';
import { spawnWorker, terminateWorker } from './workerManager';


const REPO_LIST_FILENAME = 'repositories.yaml';

const REPO_LIST_PATH = path.join(app.getPath('userData'), REPO_LIST_FILENAME);

const readerWorker = spawnWorker();
app.on('quit', async () => await terminateWorker(await readerWorker));


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
      const rawData = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
      data = yaml.load(rawData) || { workingCopies: {} };
    } catch (e) {
      data = { workingCopies: {} };
    }

    const newData = updater(data);
    const newRawData = yaml.dump(newData);

    await fs.writeFile(REPO_LIST_PATH, newRawData, { encoding: 'utf-8' });
  });
}


// Defaults

export async function setNewRepoDefaults(defaults: NewRepositoryDefaults) {
  if (defaultsAreComplete(defaults)) {
    return await updateRepositories((data) => ({
      ...data,
      defaults,
    }));
  } else {
    log.error("setNewRepoDefaults: defaults given are incomplete", defaults);
    throw new Error("New repo defaults are incomplete");
  }
}

export async function getNewRepoDefaults(): Promise<NewRepositoryDefaults> {
  const defaults = (await readRepositories()).defaults;

  if (defaults && defaultsAreComplete(defaults)) {
    return { remote: defaults.remote, author: defaults.author };
  } else {
    throw new Error("Defaults are missing");
  }
}

function defaultsAreComplete(defaults: Partial<NewRepositoryDefaults>): defaults is NewRepositoryDefaults {
  return defaults.author?.email && defaults.author?.name && defaults.branch ? true : false;
}


// Paneron meta

export async function readPaneronRepoMeta(workingCopyPath: string): Promise<PaneronRepository> {
  const meta = (await (await readerWorker).repo_getBufferDataset({
    workDir: workingCopyPath,
    paths: [PANERON_REPOSITORY_META_FILENAME],
  }))[PANERON_REPOSITORY_META_FILENAME];

  if (meta === null) {
    throw new Error("Paneron repository metadata file is not found");
  } else {
    return deserializeMeta(meta);
  }
}


// Dataset meta

export const DATASET_FILENAME = 'panerondataset.yaml';


export async function readDatasetMeta
(workDir: string, datasetDir: string):
Promise<DatasetInfo> {
  const datasetDirNormalized = normalizeDatasetDir(datasetDir);
  const datasetMetaPath = `/${path.join(datasetDirNormalized, DATASET_FILENAME)}`;
  const meta = (await (await readerWorker).repo_getBufferDataset({
    workDir,
    paths: [datasetMetaPath],
  }))[datasetMetaPath];

  if (meta === null) {
    throw new Error("Missing dataset metadata file");
  } else {
    return deserializeMeta(meta);
  }
}
