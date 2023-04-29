import log from 'electron-log';
import { debounce } from 'throttle-debounce';

import React from 'react';
import ReactDOM from 'react-dom';

import { Spinner } from '@blueprintjs/core';
import '!style-loader!css-loader!@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/annotated.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/html.css';
import '!style-loader!css-loader!@blueprintjs/core/lib/css/blueprint.css';
import '!style-loader!css-loader!@blueprintjs/popover2/lib/css/blueprint-popover2.css';
import '!style-loader!css-loader!react-resizable/css/styles.css';
import '!style-loader!css-loader!./normalize.css';
import '!style-loader!css-loader!./renderer.css';

import ErrorState from '@riboseinc/paneron-extension-kit/widgets/ErrorState';

import type { WindowComponentProps } from 'window/types';


type DefaultImporter<T> = () => Promise<{ default: T | Promise<T> }>;

type WindowComponentImporter = DefaultImporter<React.FC<WindowComponentProps>>;

const WINDOW_COMPONENTS: {
  [componentID: string]: WindowComponentImporter
} = {
  mainWindow: () => import('./MainWindow/index'),
}


require('events').EventEmitter.defaultMaxListeners = 20;


import { getColorScheme, colorSchemeUpdated } from 'common';


function applyColorScheme(opts: { colorSchemeName: string }) {
  if (opts.colorSchemeName === 'dark') {
    document.body.classList.add('bp4-dark');
    document.body.style.backgroundColor = 'black';
  } else {
    document.body.classList.remove('bp4-dark');
    document.body.style.backgroundColor = 'white';
  }
}
const applyColorSchemeDebounced = debounce(1000, applyColorScheme);


async function renderApp() {
  const { result: colorSchemeQueryResult } = await getColorScheme.renderer!.trigger({});
  applyColorScheme(colorSchemeQueryResult);
  colorSchemeUpdated.renderer!.handle(applyColorSchemeDebounced);

  // electron-webpack guarantees presence of #app in index.html it bundles
  const containerEl: HTMLElement | null = document.getElementById('app');

  if (containerEl === null) {
    log.error("Could not find container element to instantiate the app in");
    throw new Error("Missing app container");
  }

  ReactDOM.render(<Spinner className="initial-spinner" />, containerEl);

  // Get all params passed to the window via GET query string
  const searchParams = new URLSearchParams(window.location.search);

  let topLevelEl: JSX.Element = <ErrorState
    viewName="window"
    technicalDetails="This window’s component could not be found. This is probably a problem in the app." />;

  // Prepare getter for requested top-level window UI React component
  const componentID = searchParams.get('c');

  log.debug("Opening window", componentID);

  if (componentID !== null) {
    const importer = WINDOW_COMPONENTS[componentID];
    if (importer) {
      try {
        let Component = (await importer()).default;
        if (typeof Component !== 'function') {
          Component = await Component;
        }
        topLevelEl = <Component query={searchParams} />;
      } catch (e) {
        log.error(`Unable to import or initialize top-level window component ${componentID}`, e);
        topLevelEl = <ErrorState
          viewName="window"
          error={(e as any)?.toString() ?? `${e}`}
          technicalDetails={<>Unable to initialize component <code>{componentID}</code>.</>} />;
      }
    }
  } else {
    log.error("No window component specified", searchParams);
  }

  ReactDOM.render(topLevelEl, containerEl);
}

renderApp();


import 'common';
import 'repositories/ipc';
import 'datasets/ipc';
