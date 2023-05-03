import * as path from 'path'
import { format as formatUrl } from 'url';
import { app, BrowserWindow, Menu } from 'electron';
import log from 'electron-log';

import { type WindowOpenerParams, isComponentWindowSource, isExternalWindowSource } from './types';

import { getEffectiveColorSchemeName } from '../main/colorScheme';


const isDevelopment = process.env.NODE_ENV !== 'production';
const isMacOS = process.platform === 'darwin';


// TODO: This is pretty inelegant

// Keeps track of windows and ensures (?) they do not get garbage collected
export let windows: BrowserWindow[] = [];

// Allows to locate window ID by label
let windowsByTitle: { [title: string]: BrowserWindow } = {};

// Allows to locate window by ID
let windowsByID: { [id: number]: BrowserWindow } = {};

// Tracks promises for windows
let windowsBeingOpened: { [title: string]: Promise<BrowserWindow> } = {};

// Open new window, or focus if one with the same title already exists
export type WindowOpener = (props: WindowOpenerParams & { menu?: Menu }) => Promise<BrowserWindow>;
export const open: WindowOpener = async (props) => {

  const {
    title,
    dimensions, frameless,
    winParams, ignoreCache,
    showWhileLoading,
    forceDebug, quitAppOnClose,
    menu,
  } = props;

  const _existingWindow = getByTitle(title);
  if (_existingWindow !== undefined) {
    _existingWindow.show();
    _existingWindow.focus();
    return _existingWindow;
  }

  if (windowsBeingOpened[title] === undefined) {
    windowsBeingOpened[title] = (async (): Promise<BrowserWindow> => {
      try {
        const _framelessOpts = {
          titleBarStyle: isMacOS ? 'hiddenInset' : undefined,
        };

        const _winParams = {
          width: (dimensions || {}).width,
          minWidth: (dimensions || {}).minWidth,
          height: (dimensions || {}).height,
          minHeight: (dimensions || {}).minHeight,
          ...(frameless === true ? _framelessOpts : {}),
          ...winParams,
        };

        let window: BrowserWindow;
        let windowID: number;

        if (isComponentWindowSource(props)) {
          const { component, componentParams } = props;
          const colorScheme = await getEffectiveColorSchemeName();
          const params = `colorScheme=${colorScheme}&c=${component}&${componentParams || ''}`;

          window = await createWindowForLocalComponent(
            title,
            params,
            _winParams,
            showWhileLoading === true,
            forceDebug || false);

        } else if (isExternalWindowSource(props)) {
          const { url } = props;

          window = await createWindow(
            title,
            url,
            _winParams,
            showWhileLoading === true,

            // TODO: Check that it shouldn’t be forceDebug instead?
            ignoreCache);

        } else {
          throw new Error("window.openWindow() expects either component or url");
        }

        if (quitAppOnClose) {
          window.on('closed', app.quit);
        }

        windowID = window.id;

        if (menu !== undefined && process.platform !== 'darwin') {
          log.debug("Setting menu");
          window.setMenu(menu);
        }

        windows.push(window);
        windowsByTitle[title] = window;
        windowsByID[windowID] = window;

        window.on('closed', () => {
          delete windowsByTitle[title];
          delete windowsByID[windowID];
          cleanUpWindows();
        });

        return window;

      } catch (e) {
        log.error("Error opening window", e)
        throw e;

      } finally {
        delete windowsBeingOpened[title];
      }
    })();
  } else {
    log.warn("Race! A window with this title is already being opened:", title)
  }

  return windowsBeingOpened[title];
}


export function getByTitle(title: string): BrowserWindow | undefined {
  return windowsByTitle[title];
}

export function getByID(id: number): BrowserWindow | undefined {
  return windowsByID[id];
}


export function close(title: string) {
  const win = getByTitle(title);
  if (win !== undefined) {
    win.close();
  }
}


export function get(func: (win: BrowserWindow) => boolean): BrowserWindow | undefined {
  return windows.find(func);
}


function cleanUpWindows() {
  // Iterate over array of windows and try accessing window ID.
  // If it throws, window was closed and we remove it from the array.
  // Supposed to be run after any window is closed

  let deletedWindows: number[] = [];
  for (const [idx, win] of windows.entries()) {
    // When accessing the id attribute of a closed window,
    // it’ll throw. We’ll mark its index for deletion then.
    try {
      win.id;
    } catch (e) {
      deletedWindows.push(idx - deletedWindows.length);
    }
  }
  for (const idx of deletedWindows) {
    windows.splice(idx, 1);
  }
}


async function createWindowForLocalComponent(
    title: string,
    params: string,
    winParams: any,
    showWhileLoading: boolean,
    forceDebug: boolean): Promise<BrowserWindow> {

  let url: string;

  if (isDevelopment) {
    url = `http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}?${params}`;
  }
  else {
    url = `${formatUrl({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file',
      slashes: true,
    })}?${params}`;
  }

  const window = await createWindow(title, url, winParams, showWhileLoading, forceDebug || isDevelopment);

  window.removeMenu();

  if (forceDebug || isDevelopment) {
    window.webContents.on('devtools-opened', () => {
      window.focus();
      setImmediate(() => {
        window.focus()
      });
    });
    window.webContents.openDevTools();
  }

  return window;
}


async function createWindow(
    title: string,
    url: string,
    winParams: any,
    showWhileLoading: boolean,
    debug: boolean = false): Promise<BrowserWindow> {

  const window = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: !debug,
    },
    title: title,
    show: showWhileLoading === true,
    ...winParams
  });

  if (debug) {
    window.loadURL(url, { 'extraHeaders': 'pragma: no-cache\n' });
  } else {
    window.loadURL(url);
  }

  if (showWhileLoading) {
    return window;
  } else {
    return new Promise<BrowserWindow>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log.error("Window is not ready to show after reasonable amount of time");
        reject();
      }, 20000);
      window.once('ready-to-show', () => {
        clearTimeout(timeout);
        window.show();
        resolve(window);
      });
    });
  }
}


export function notifyAll(eventName: string, payload?: any) {
  windows.map(async (window) => {
    if (window) {
      window.webContents.send(eventName, payload);
    }
  });
}


export function notifyWithTitle(windowTitle: string, eventName: string, payload?: any) {
  const window = getByTitle(windowTitle);
  if (window) {
    window.webContents.send(eventName, payload);
  }
}

export function refreshByID(windowID: number) {
  const window = getByID(windowID);
  if (window) {
    window.reload();
  } else {
    throw new Error("Cannot refresh window: no window with such ID");
  }
}

export function setMenuByID(windowID: number, menu: Menu) {
  const window = getByID(windowID);
  if (window) {
    window.setMenu(menu);
  } else {
    throw new Error("Cannot set window menu: no window with such ID");
  }
}
