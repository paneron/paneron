/**
 * Reading & updating Paneron user’s runtime repository configuration
 * (not what is stored in repository itself, but what is stored
 * in Paneron app data).
 *
 * TODO: Rename module to “repoConfig” (since it’s not just reading).
 * TODO: Validate type at runtime using some sane isomorphic library.
 */

import path from 'path';
import fs from 'fs-extra';
import AsyncLock from 'async-lock';
import { app } from 'electron';
import log from 'electron-log';

import yaml from '@riboseinc/paneron-extension-kit/object-specs/yaml';

import { GitRepository, LFSParams, NewRepositoryDefaults } from '../types';
import { getAuth } from './remoteAuth';
import { RemoteNotConfiguredError } from 'repositories/errors';


/** File name that keeps Paneron user’s repository configuration at runtime. */
const REPO_LIST_FILENAME = 'repositories.yaml';

/** Absolute path to Paneron user’s repository configuration at runtime. */
const REPO_LIST_PATH = path.join(app.getPath('userData'), REPO_LIST_FILENAME);


/** Paneron user’s repository configuration. */
interface RepoListSpec {
  defaults?: NewRepositoryDefaults;
  workingCopies: {
    [path: string]: Omit<GitRepository, 'workingCopyPath'>;
  };
}

const FileAccessLock = new AsyncLock();

export async function clearRepoConfig() {
  await fs.remove(REPO_LIST_PATH);
}

/** Clears repository working directory data (for real, irreversible). */
export async function clearRepoData() {
  const workingCopyPaths = Object.keys((await readRepositories()).workingCopies);
  for (const wcPath of workingCopyPaths) {
    try {
      fs.rmdirSync(wcPath, { recursive: true });
    } catch (e) {
      log.error("Error clearing repository working path", wcPath);
    }
  }
}


/** Reads configuration for a single repository. */
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


/** Reads Paneron user’s repositories. */
export async function readRepositories(): Promise<RepoListSpec> {
  await fs.ensureFile(REPO_LIST_PATH);
  try {
    const rawData = await fs.readFile(REPO_LIST_PATH, { encoding: 'utf-8' });
    const data = yaml.load(rawData);

    if (data.workingCopies) {
      return (data as RepoListSpec);
    } else {
      return { workingCopies: {} };
    }
  } catch (e) {
    return { workingCopies: {} };
  }
}


/**
 * Updates Paneron user’s repositories.
 * Takes a function that gets the old configuration, and returns a new one.
 */
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


/** Based on repository config, returns LFS params. */
export async function readLFSParams(workDir: string): Promise<LFSParams> {
  const { remote } = await readRepoConfig(workDir);
  if (remote) {
    const { username, url } = remote;
    const { password } = await getAuth(url, username);
    if (password !== undefined) {
      return {
        url,
        auth: { username, password },
      };
    } else {
      throw new Error("Remote password not provided, but required to collect LFS params")
    }
  } else {
    throw new RemoteNotConfiguredError();
  }
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
    return { remote: defaults.remote, author: defaults.author, branch: defaults.branch };
  } else {
    throw new Error("Defaults are missing");
  }
}

function defaultsAreComplete(defaults: Partial<NewRepositoryDefaults>): defaults is NewRepositoryDefaults {
  return defaults.author?.email && defaults.author?.name && defaults.branch ? true : false;
}
