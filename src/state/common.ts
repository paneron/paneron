import { EmptyPayload, makeEndpoint, _ } from 'ipc';


export const resetStateGlobal = makeEndpoint.main(
  'resetStateGlobal',
  <EmptyPayload>_,
  <{ success: true }>_,
);


export const resetState = makeEndpoint.main(
  'resetState',
  <{ key: string }>_,
  <{ success: true }>_,
);


export const storeState = makeEndpoint.main(
  'storeState',
  <{ key: string, newState: Record<string, any> }>_,
  <{ success: true }>_,
);


export const loadState = makeEndpoint.main(
  'loadState',
  <{ key: string }>_,
  <{ state: Record<string, any> | undefined }>_,
);
