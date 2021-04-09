import log from 'electron-log';
import { makeEndpoint, _ } from '../ipc';
import { open as openWindow } from './main';
import { WindowComponentProps, WindowOptions, WindowOpenerParams } from './types';


//export const openWindow = makeEndpoint('open-window', 'main', <WindowOpenerParams>_, <{}>_);

type DefaultImporter<T> = () => Promise<{ default: T | Promise<T> }>;

type WindowComponentImporter = DefaultImporter<React.FC<WindowComponentProps>>;

let windowComponents: {
  [key: string]: WindowComponentImporter
} = {}


export function getComponent(key: string) {
  log.debug("Getting component", key, windowComponents);
  return windowComponents[key];
}


export function makeWindowForComponent
(componentName: string, importer: WindowComponentImporter, title: string, opts?: Omit<WindowOptions, 'title'>) {

  type AdHocOptions = {
    title?: string
    componentParams?: string
  } & Omit<WindowOptions, 'title'>;

  if (windowComponents[componentName]) {
    log.error("Attempt to register duplicate component", componentName);
    throw new Error("Attempt to register duplicate window component");
  } else {
    windowComponents[componentName] = importer;
  }

  const windowEndpoint = makeEndpoint.main(
    `open-window-${componentName}`,
    <AdHocOptions>_,
    <{ opened: boolean }>_,
  );

  async function open(extraOpts: AdHocOptions) {
    const effectiveParams: WindowOpenerParams = {
      ...opts,
      component: componentName,
      componentParams: extraOpts.componentParams,
      title: `${title} ${extraOpts.title || ''}`,
    };

    await openWindow(effectiveParams);
  }

  if (process.type === 'browser') {
    windowEndpoint.main!.handle(async (opts) => {
      await open(opts);
      return { opened: true };
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
          return await windowEndpoint.renderer!.trigger(opts || {});
        },
      },
    };

  } else {
    throw new Error("Unsupported process type");

  }
};
