import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, dialog, Menu, protocol, shell } from 'electron';
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

import { clearDataAndRestart, ClearOption, openExternalURL, refreshMainWindow, saveFileToFilesystem, selectDirectoryPath } from '../common';
import { chooseFileFromFilesystem, makeRandomID } from '../common';

import { WindowOpenerParams } from '../window/types';
import { resetStateGlobal } from '../state/manage';
import { clearPluginData } from '../plugins/main';
import { clearRepoConfig, clearRepoData } from 'repositories/main/readRepoConfig';
import { clearIndexes } from '../datasets/main';
import { refreshByID, open as openWindow } from '../window/main';

import mainMenu from './mainMenu';


const isDevelopment = process.env.NODE_ENV !== 'production';


const MAIN_WINDOW_OPTIONS: WindowOpenerParams = {
  component: 'mainWindow', // Component location is defined in renderer initialization
  title: "Paneron",
  dimensions: {
    minWidth: 800,
    minHeight: 600,
    width: 800,
    height: 600,
  },
  quitAppOnClose: true,
  menu: mainMenu,
};


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


function handleAllWindowsClosed(e: Electron.Event) {
  log.warn("All windows closed (not quitting)");
  e.preventDefault();
}


(async function initMain() {

  log.catchErrors({ showDialog: true });

  // Ensure only one instance of the app can run at a time on given user’s machine
  // by exiting any future instances
  if (!app.requestSingleInstanceLock()) {
    log.error("App is already running");
    app.exit(0);
  }

  // Prevent closing windows from quitting the app during startup
  app.on('window-all-closed', handleAllWindowsClosed);

  await app.whenReady();

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

  openExternalURL.main!.handle(async ({ url }) => {
    shell.openExternal(url);
    return {};
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

  selectDirectoryPath.main!.handle(async (opts) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window === null) { throw new Error("Unable to choose file: no focused window detected"); }

    const result = await dialog.showOpenDialog(window, {
      properties: [
        'openDirectory',
      ],
    });

    const filepaths = (result.filePaths || []);

    log.info("Select directory path from filesystem: got", filepaths[0]);

    return { directoryPath: filepaths[0] };
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

  const { id: windowID } = await openWindow(MAIN_WINDOW_OPTIONS);

  refreshMainWindow.main!.handle(async () => {
    // Will throw if window is not open
    // (But then app quits if it’s closed anyway)
    refreshByID(windowID);
    return {};
  });

  if (process.platform === 'darwin') {
    log.debug("Setting app menu (Mac)");
    Menu.setApplicationMenu(mainMenu);
  }

  // Prevent closing windows from quitting the app during startup
  app.off('window-all-closed', handleAllWindowsClosed);


  // NOTE: This might be useful later, for gradually extending main menu.
  // let currentMainMenu = mainMenu;
  // function mutateMainMenu(adjuster: (oldMainMenu: Menu) => Menu) {
  //   currentMainMenu = adjuster(currentMainMenu);
  //   if (process.platform === 'darwin') {
  //     log.debug("Setting app menu (Mac)");
  //     Menu.setApplicationMenu(currentMainMenu);
  //   } else {
  //     setMenuByID(windowID, currentMainMenu)
  //   }
  // }

})();
