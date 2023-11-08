import { debounce } from 'throttle-debounce';
import { ImportMapper } from 'import-mapper';

import React from 'react';
import ReactDOM from 'react-dom';

import '!style-loader!css-loader!@blueprintjs/datetime/lib/css/blueprint-datetime.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/annotated.css';
import '!style-loader!css-loader!jsondiffpatch/dist/formatters-styles/html.css';
import '!style-loader!css-loader!@blueprintjs/core/lib/css/blueprint.css';
import '!style-loader!css-loader!@blueprintjs/popover2/lib/css/blueprint-popover2.css';
import '!style-loader!css-loader!react-resizable/css/styles.css';
import '!style-loader!css-loader!./normalize.css';
import '!style-loader!css-loader!./renderer.css';

import ErrorBoundary from '@riboseinc/paneron-extension-kit/widgets/ErrorBoundary';
import MainWindow from './MainWindow/index';

import { openExternalURL, colorSchemeUpdated } from 'common';


// Set color scheme

function applyColorScheme(opts: { colorSchemeName: string }) {
  if (opts.colorSchemeName === 'dark') {
    document.body.classList.add('bp4-dark');
    document.body.style.backgroundColor = 'black';
  } else {
    document.body.classList.remove('bp4-dark');
    document.body.style.backgroundColor = 'white';
  }
}

// Params passed to the window from main via GET query string
const searchParams = new URLSearchParams(window.location.search);
const colorScheme = searchParams.get('colorScheme');
if (colorScheme) { applyColorScheme({ colorSchemeName: colorScheme }); }

// electron-webpack guarantees presence of #app in index.html it bundles
const containerEl: HTMLElement | null = document.getElementById('app');
if (containerEl === null) {
  throw new Error("Missing app container");
}

// Do the rest.

const applyColorSchemeDebounced = debounce(1000, applyColorScheme);
colorSchemeUpdated.renderer!.handle(applyColorSchemeDebounced);

window.addEventListener('click', function handlePossibleNavigation (evt) {
  const linkHref = (evt.target as Element | null)?.getAttribute?.('href')?.trim() || '';
  if (linkHref !== '' && linkHref.startsWith('http')) {
    evt.preventDefault();
    evt.stopPropagation();
    openExternalURL.renderer!.trigger({ url: linkHref });
    return 'overriding click';
  }
});

async function render() {
  await setUpDeps();

  ReactDOM.render(
    <ErrorBoundary viewName="Main window">
      <MainWindow />
    </ErrorBoundary>,
    containerEl);
}


render();


import 'common';
import 'repositories/ipc';
import 'datasets/ipc';


// To make dependencies importable within imported extension code

async function getDeps(): Promise<Record<string, unknown>> {
  return {
    'react': await import('react'),
    '@emotion/styled': await import('@emotion/styled'),
    '@emotion/react': await import('@emotion/react'),
    '@blueprintjs/core': await import('@blueprintjs/core'),
    '@blueprintjs/popover2': await import('@blueprintjs/popover2'),
    'react-mathjax2': await import('react-mathjax2'),
    'liquidjs': await import('liquidjs'),

    '@riboseinc/paneron-extension-kit': await import('@riboseinc/paneron-extension-kit'),
    '@riboseinc/paneron-registry-kit': await import('@riboseinc/paneron-registry-kit'),
    '@riboseinc/paneron-registry-kit/migrations/initial': await import('@riboseinc/paneron-registry-kit/migrations/initial'),
    '@riboseinc/paneron-registry-kit/views': await import('@riboseinc/paneron-registry-kit/views'),
    '@riboseinc/paneron-registry-kit/views/FilterCriteria/CRITERIA_CONFIGURATION': await import('@riboseinc/paneron-registry-kit/views/FilterCriteria/CRITERIA_CONFIGURATION'),
    '@riboseinc/paneron-registry-kit/views/util': await import('@riboseinc/paneron-registry-kit/views/util'),
    '@riboseinc/paneron-registry-kit/views/BrowserCtx': await import('@riboseinc/paneron-registry-kit/views/BrowserCtx'),
    '@riboseinc/paneron-registry-kit/views/itemPathUtils': await import('@riboseinc/paneron-registry-kit/views/itemPathUtils'),
    '@riboseinc/paneron-extension-kit/context': await import('@riboseinc/paneron-extension-kit/context'),
  };
}

async function setUpDeps() {
  const deps = await getDeps();

  const imports: Record<string, string> = {};
  for (const [moduleID, _moduleData] of Object.entries(deps)) {
    const m = _moduleData as any;
    const moduleData = m.default ?? _moduleData;
    imports[moduleID] = ImportMapper.forceDefault(moduleData);
  }

  const mapper = new ImportMapper(imports);
  mapper.register();
}
