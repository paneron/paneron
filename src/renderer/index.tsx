import log from 'electron-log';

import React from 'react';
import ReactDOM from 'react-dom';

import { NonIdealState, Spinner } from '@blueprintjs/core';
import '!style-loader!css-loader!@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import '!style-loader!css-loader!@blueprintjs/core/lib/css/blueprint.css';
import '!style-loader!css-loader!./normalize.css';
import '!style-loader!css-loader!./renderer.css';

import { getComponent } from 'window';


async function renderApp() {
  // electron-webpack guarantees presence of #app in index.html it bundles
  const containerEl: HTMLElement | null = document.getElementById('app');

  if (containerEl === null) {
    log.error("Could not find container element to instantiate the app in");
    throw new Error("Missing app container");
  }

  ReactDOM.render(<Spinner className="initial-spinner" />, containerEl);

  // Get all params passed to the window via GET query string
  const searchParams = new URLSearchParams(window.location.search);

  let topLevelEl: JSX.Element = <NonIdealState
    icon="heart-broken"
    title="Ouch"
    description="This window’s component could not be found. This is probably a problem in the app." />;

  // Prepare getter for requested top-level window UI React component
  const componentID = searchParams.get('c');

  if (componentID !== null) {
    const importer = getComponent(componentID);
    if (importer) {
      try {
        let Component = (await importer()).default;
        if (typeof Component !== 'function') {
          Component = await Component;
        }
        topLevelEl = <Component query={searchParams} />;
      } catch (e) {
        log.error(`Unable to import or initialize top-level window component ${componentID}`, e);
        topLevelEl = <NonIdealState
          icon="heart-broken"
          title="Ouch"
          description="This window failed to initialize" />;
      }
    }
  } else {
    log.error("No window component specified", searchParams);
  }

  ReactDOM.render(topLevelEl, containerEl);
}


import 'repositories';

renderApp();
