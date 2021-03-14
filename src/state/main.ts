import path from 'path';
import { app } from 'electron';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';
import { loadState, storeState } from './common';


const STATE_STORAGE_PATH = path.join(app.getPath('userData'), 'state');
const stateStorage = levelup(encode(leveldown(STATE_STORAGE_PATH), {
  keyEncoding: 'string',
  valueEncoding: 'json',
}));


loadState.main!.handle(async ({ key }) => {
  return await stateStorage.get(key);
});


storeState.main!.handle(async ({ key, newState }) => {
  await stateStorage.put(key, newState);
  return { success: true };
});
