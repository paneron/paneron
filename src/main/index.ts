import { app } from 'electron';
import log from 'electron-log';

import { repositoryDashboard } from '../repositories';

import 'main/plugins';
import 'main/repositories';


function preventDefault(e: Electron.Event) {
  e.preventDefault();
}

async function initMain() {

  log.catchErrors({ showDialog: true });

  // Ensure only one instance of the app can run at a time on given user’s machine
  // by exiting any future instances
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
  }

  // Prevent closing windows from quitting the app during startup
  app.on('window-all-closed', preventDefault);

  await app.whenReady();

  // Prevent closing windows from quitting the app during startup
  app.off('window-all-closed', preventDefault);

  repositoryDashboard.main!.open();

}

initMain();
