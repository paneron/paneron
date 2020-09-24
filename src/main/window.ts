import * as path from 'path'
import { format as formatUrl } from 'url';
import { BrowserWindow, Menu } from 'electron';
import log from 'electron-log';

import { WindowOpenerParams, isComponentWindowSource, isExternalWindowSource } from '../window';


const isDevelopment = process.env.NODE_ENV !== 'production';
const isMacOS = process.platform === 'darwin';


// Keeps track of windows and ensures (?) they do not get garbage collected
export let windows: BrowserWindow[] = [];

// Allows to locate window ID by label
let windowsByTitle: { [title: string]: BrowserWindow } = {};

// Tracks promises for windows
let windowsBeingOpened: { [title: string]: Promise<BrowserWindow> } = {};

// Open new window, or focus if one with the same title already exists
export type WindowOpener = (props: WindowOpenerParams) => Promise<BrowserWindow>;
export const open: WindowOpener = async (props) => {

  const {
    title,
    dimensions, frameless,
    winParams, menuTemplate, ignoreCache,
    showWhileLoading,
    forceDebug
  } = props;

  const _existingWindow = getByTitle(title);
  if (_existingWindow !== undefined) {
    _existingWindow.show();
    _existingWindow.focus();
    return _existingWindow;
  }

  if (windowsBeingOpened[title] === undefined) {
    log.warn("Race! A window with this title is already being opened:", title)

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

        if (isComponentWindowSource(props)) {
          const { component, componentParams } = props;
          const params = `c=${component}&${componentParams || ''}`;

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
            ignoreCache);

        } else {
          throw new Error("window.openWindow() expects either component or url");
        }

        if (!isMacOS) {
          if (menuTemplate) {
            window.setMenu(Menu.buildFromTemplate(menuTemplate));
          } else {
            window.setMenu(null);
          }
        }

        windows.push(window);
        windowsByTitle[title] = window;

        window.on('closed', () => {
          delete windowsByTitle[title];
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
  }

  return windowsBeingOpened[title];
}


export function getByTitle(title: string): BrowserWindow | undefined {
  return windowsByTitle[title];
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
      webSecurity: !debug,
      enableRemoteModule: true,
    },
    title: title,
    show: showWhileLoading === true,
    ...winParams
  });

  const promise = new Promise<BrowserWindow>((resolve, reject) => {
    window.once('ready-to-show', () => {
      if (showWhileLoading !== true) {
        window.show();
      }
      resolve(window);
    });
    setTimeout(reject, 4000);
  });

  if (debug) {
    window.loadURL(url, { 'extraHeaders': 'pragma: no-cache\n' });
  } else {
    window.loadURL(url);
  }

  return promise;
}


export async function notifyAll(eventName: string, payload?: any) {
  await Promise.all(windows.map(async (window) => {
    if (window) {
      await window.webContents.send(eventName, payload);
    }
    return;
  }));
}


export async function notifyWithTitle(windowTitle: string, eventName: string, payload?: any) {
  const window = getByTitle(windowTitle);
  if (window) {
    await window.webContents.send(eventName, payload);
  }
}
