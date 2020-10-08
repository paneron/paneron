import fs from 'fs-extra';
import { app, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';

import { ObjectData, ObjectDataset, repositoryDashboard } from '../repositories';

import 'main/plugins';
import 'main/repositories';

import { chooseFileFromFilesystem } from 'common';


function preventDefault(e: Electron.Event) {
  log.debug("Not quitting app (windows closed)");
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

  chooseFileFromFilesystem.main!.handle(async (opts) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window === null) { throw new Error("Unable to choose file: no focused window detected"); }

    const result = await dialog.showOpenDialog(window, {
      properties: [
        'openFile',
        ...(opts.allowMultiple === true ? ['multiSelections' as const] : []),
      ],
      filters: opts.filters || [],
    });

    const filepaths = (result.filePaths || []);
    if (filepaths.length < 1) { return {}; }

    let filedata: ObjectDataset = {};

    for (const filepath of filepaths) {
      const blob = await fs.readFile(filepath);

      const encoding = filepath.endsWith('.svg') ? 'utf-8' as const : undefined;
      let parsedData: string | Uint8Array;

      if (encoding === 'utf-8') {
        parsedData = new TextDecoder(encoding).decode(blob);
      } else {
        parsedData = blob;
      }
      filedata[filepath] = {
        encoding,
        value: parsedData,
      } as ObjectData;
    }

    return filedata;
  });

  // Prevent closing windows from quitting the app during startup
  app.off('window-all-closed', preventDefault);

  repositoryDashboard.main!.open();

}

initMain();
