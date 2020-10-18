import fs from 'fs-extra';
import { app, BrowserWindow, dialog, protocol } from 'electron';
import log from 'electron-log';

import { ObjectData, ObjectDataset, repositoryDashboard } from '../repositories';

import 'main/plugins';
import 'main/repositories';

import { chooseFileFromFilesystem } from 'common';
import path from 'path';


function preventDefault(e: Electron.Event) {
  log.debug("Not quitting app (windows closed)");
  e.preventDefault();
}

const FILE_ENCODINGS: { [extension: string]: 'utf-8' | undefined } = {
  '.svg': 'utf-8' as const,
  '.png': undefined,
  '.jpeg': undefined,
  '.jpg': undefined,
};

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

  protocol.registerFileProtocol('file', (request, callback) => {
    const pathname = decodeURI(request.url.replace('file:///', ''));
    callback(pathname);
  });

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

      log.info("Choose file from filesystem: got files", filepaths, result);

      const ext = path.extname(filepath);
      if (Object.keys(FILE_ENCODINGS).indexOf(ext) < 0) {
        log.error("Choosing file from filesystem: unknown file type", ext);
        throw new Error("Unknown file type");
      }

      const encoding = FILE_ENCODINGS[path.extname(filepath)];

      let parsedData: string | Uint8Array;

      if (encoding === 'utf-8') {
        parsedData = new TextDecoder(encoding).decode(blob);
      } else {
        parsedData = blob;
      }
      filedata[conformSlashes(filepath)] = {
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




function conformSlashes(path: string): string {
	const isExtendedLengthPath = /^\\\\\?\\/.test(path);
  const hasNonAscii = /[^\u0000-\u0080]+/.test(path); // eslint-disable-line no-control-regex
  
  log.info("Conforming slashes", path);

	if (isExtendedLengthPath || hasNonAscii) {
    log.info("Won’t conform slashes");
		return path;
  }

  log.info("Conforming slashes: done", path.replace(/\\/g, '/'));

	return path.replace(/\\/g, '/');
}
