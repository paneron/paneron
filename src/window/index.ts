import log from 'electron-log';
import { EmptyPayload, makeEndpoint, _ } from '../ipc';
import { open as openWindow, refreshByID } from './main';
import { WindowComponentProps, WindowOptions, WindowOpenerParams } from './types';


//export const openWindow = makeEndpoint('open-window', 'main', <WindowOpenerParams>_, <{}>_);

type DefaultImporter<T> = () => Promise<{ default: T | Promise<T> }>;

type WindowComponentImporter = DefaultImporter<React.FC<WindowComponentProps>>;

let windowComponents: {
  [componentName: string]: WindowComponentImporter
} = {}


export function getComponent(componentName: string) {
  log.silly("Getting window component", componentName, windowComponents);
  return windowComponents[componentName];
}


export function makeWindowForComponent
(componentName: string, importer: WindowComponentImporter, title: string, opts?: Omit<WindowOptions, 'title'>) {

  type AdHocOptions = {
    title?: string
    componentParams?: string
  } & Omit<WindowOptions, 'title'>;

  let windowID: number | null = null;

  if (windowComponents[componentName]) {
    log.error("Attempt to register duplicate component", componentName);
    throw new Error("Attempt to register duplicate window component");
  } else {
    windowComponents[componentName] = importer;
  }

  const windowOpenEndpoint = makeEndpoint.main(
    `open-window-${componentName}`,
    <AdHocOptions>_,
    <{ opened: boolean }>_,
  );

  const windowRefreshEndpoint = makeEndpoint.main(
    `refresh-window-${componentName}`,
    <EmptyPayload>_,
    <{ success: true }>_,
  );

  async function open(extraOpts: AdHocOptions) {
    const effectiveParams: WindowOpenerParams = {
      ...opts,
      component: componentName,
      componentParams: extraOpts.componentParams,
      title: `${title} ${extraOpts.title ?? ''}`,
    };

    const win = await openWindow(effectiveParams);
    windowID = win.id;
  }

  if (process.type === 'browser') {
    windowOpenEndpoint.main!.handle(async (opts) => {
      await open(opts);
      return { opened: true };
    });
    windowRefreshEndpoint.main!.handle(async () => {
      if (windowID) {
        refreshByID(windowID);
      } else {
        throw new Error("windowRefreshEndpoint: ID is missing");
      }
      return { success: true };
    });

    return {
      main: {
        open: async (opts?: AdHocOptions) => {
          await open(opts || {});
        },
      },
    };

  } else if (process.type === 'renderer') {
    return {
      renderer: {
        open: async (opts?: AdHocOptions) => {
          return await windowOpenEndpoint.renderer!.trigger(opts || {});
        },
        refresh: async () => {
          return await windowRefreshEndpoint.renderer!.trigger({});
        },
      },
    };

  } else {
    throw new Error("Unsupported process type");

  }
};
