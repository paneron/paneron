import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, dialog, protocol } from 'electron';
import log from 'electron-log';
import type { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';


require('events').EventEmitter.defaultMaxListeners = 20;


if (process.platform === 'linux' && process.env.SNAP && process.env.SNAP_USER_COMMON) {
  app.setPath(
    'userData',
    path.join(process.env.SNAP_USER_COMMON, '.config', app.getName()));
  app.setAppLogsPath();
}

import { makeUUIDv4 } from 'utils';

// No-op import to execute initialization code
import '../state/main';
import '../plugins/main';
import '../repositories/main';
import '../datasets/main';
import '../clipboard/main';

import { clearDataAndRestart, ClearOption, mainWindow, saveFileToFilesystem } from '../common';
import { chooseFileFromFilesystem, makeRandomID } from '../common';

import { resetStateGlobal } from '../state/manage';
import { clearPluginData } from '../plugins/main';
import { clearRepoConfig, clearRepoData } from 'repositories/main/readRepoConfig';
import { clearIndexes } from '../datasets/main';


const isDevelopment = process.env.NODE_ENV !== 'production';


function preventDefault(e: Electron.Event) {
  log.warn("All windows closed (not quitting)");
  e.preventDefault();
}

async function initMain() {

  log.catchErrors({ showDialog: true });

  // Ensure only one instance of the app can run at a time on given user’s machine
  // by exiting any future instances
  if (!app.requestSingleInstanceLock()) {
    log.error("App is already running");
    app.exit(0);
  }

  // Prevent closing windows from quitting the app during startup
  app.on('window-all-closed', preventDefault);

  await app.whenReady();

  //protocol.registerFileProtocol('file', (request, callback) => {
  //  const pathname = decodeURI(request.url.replace('file:///', ''));
  //  callback(pathname);
  //});
  protocol.registerFileProtocol('file', (request, cb) => {
    const components = request.url.replace('file:///', '').split('?', 2);
    if (isDevelopment) {
      cb(components.map(decodeURI)[0]);
    } else {
      cb(components.map(decodeURI).join('?'));
    }
  });


  // Shared IPC

  makeRandomID.main!.handle(async () => {
    return { id: makeUUIDv4() };
  });

  chooseFileFromFilesystem.main!.handle(async (opts) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window === null) { throw new Error("Unable to choose file: no focused window detected"); }

    const result = await dialog.showOpenDialog(window, {
      properties: [
        'openFile',
        ...(opts.allowMultiple === true ? ['multiSelections' as const] : []),
      ],
      filters: opts.filters ?? [],
    });

    const filepaths = (result.filePaths || []);

    if (filepaths.length < 1 || result.canceled) {
      return {};
    }

    let filedata: BufferDataset = {};

    for (const _f of filepaths) {
      const blob = await fs.promises.readFile(_f);
      const filepath = path.basename(_f);

      log.info("Choose file from filesystem: got file", _f, filepath, result);

      filedata[filepath] = blob;
    }

    return filedata;
  });

  saveFileToFilesystem.main!.handle(async ({ dialogOpts, bufferData }) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window === null) { throw new Error("Unable to save file: no focused window detected"); }

    const result = await dialog.showSaveDialog(
      window, {
        ...dialogOpts,
        title: dialogOpts.prompt,
      });

    if (result.filePath) {
      await fs.promises.writeFile(result.filePath, bufferData);
      return { success: true, savedToFileAtPath: result.filePath };
    } else {
      throw new Error("No file path was available from save dialog");
    }
  });

  const CLEAR_OPTION_ROUTINES: Record<ClearOption, () => Promise<void>> = {
    'ui-state': async () => {
      await resetStateGlobal();
    },
    'db-indexes': async () => {
      await clearIndexes();
    },
    plugins: async () => {
      await clearPluginData();
    },
    repositories: async () => {
      await clearRepoConfig();
      await clearRepoData();
    },
  };

  clearDataAndRestart.main!.handle(async ({ options }) => {
    const opts: ClearOption[] = Object.entries(options).filter(([, checked]) => checked === true).map(([optID, ]) => optID as ClearOption);

    console.warn("Clearing data according to options", opts);

    for (const opt of opts) {
      await CLEAR_OPTION_ROUTINES[opt]();
    }

    app.relaunch();
    app.quit();

    return { success: true };
  });

  // Prevent closing windows from quitting the app during startup
  app.off('window-all-closed', preventDefault);

  mainWindow.main!.open();

}

initMain();




// function conformSlashes(path: string): string {
// 	const isExtendedLengthPath = /^\\\\\?\\/.test(path);
//   const hasNonAscii = /[^\u0000-\u0080]+/.test(path); // eslint-disable-line no-control-regex
//   
//   log.info("Conforming slashes", path);
// 
// 	if (isExtendedLengthPath || hasNonAscii) {
//     log.info("Won’t conform slashes");
// 		return path;
//   }
// 
//   log.info("Conforming slashes: done", path.replace(/\\/g, '/'));
// 
// 	return path.replace(/\\/g, '/');
// }
