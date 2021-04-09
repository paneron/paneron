import log from 'electron-log';
import AsyncLock from 'async-lock';

import { DatasetInfo } from '../datasets/types';
import { readPaneronRepoMeta, readDatasetMeta } from '../repositories/main/readRepoConfig';
import { PaneronRepository } from '../repositories/ipc';

import { getClipboardStatus, copyObjects, requestCopiedObjects } from './ipc';
import { ClipboardSource, RuntimeClipboard } from './types';


const clipboard: RuntimeClipboard = { contents: null };

const clipboardLock = new AsyncLock();

function withClipboardLock<I extends any[], O>(fn: (...opts: I) => Promise<O>) {
  return (...opts: I): Promise<O> => {
    return clipboardLock.acquire('1', async () => await fn(...opts));
  };
}


copyObjects.main!.handle(withClipboardLock(async ({ workDir, datasetDir, objects }) => {
  if (clipboard.contents) {
    for (const key of Object.keys(clipboard.contents.objects)) {
      delete clipboard.contents.objects[key];
    }
  }

  let repoMeta: PaneronRepository;
  let datasetMeta: DatasetInfo;
  try {
    repoMeta = await readPaneronRepoMeta(workDir);
    datasetMeta = await readDatasetMeta(workDir, datasetDir);
  } catch (e) {
    log.error("Failed to copy objects: unable to read repo or dataset meta", e);
    throw new Error("Unable to read repo or dataset meta");
  }

  const source: ClipboardSource = {
    repository: {
      workDir,
      title: repoMeta.title || '',
    },
    dataset: {
      dir: datasetDir,
      meta: datasetMeta,
    },
  };

  clipboard.contents = {
    source,
    objects,
  };

  return { success: true };
}));


getClipboardStatus.main!.handle(async ({ workDir, datasetDir }) => {
  if (clipboard.contents) {
    const source = clipboard.contents.source;

    const canPaste = (
      workDir !== source.repository.workDir &&
      datasetDir !== source.dataset.dir);
    // TODO: Check dataset type for compatibility

    return {
      contents: {
        source: clipboard.contents.source,
        objectCount: Object.keys(clipboard.contents.objects).length,
      },
      canPaste,
    };
  } else {
    return {
      contents: null,
      canPaste: false,
    };
  }
});


requestCopiedObjects.main!.handle(withClipboardLock(async () => {
  if (clipboard.contents) {
    return clipboard.contents.objects;
  } else {
    throw new Error("Clipboard is empty");
  }
}));
