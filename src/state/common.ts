import { makeEndpoint, _ } from 'ipc';


export const storeState = makeEndpoint.main(
  'storeState',
  <{ key: string, newState: Record<string, any> }>_,
  <{ success: true }>_,
);


export const loadState = makeEndpoint.main(
  'loadState',
  <{ key: string }>_,
  <{ state: Record<string, any> }>_,
);
