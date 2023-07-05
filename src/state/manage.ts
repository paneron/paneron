import path from 'path';
import fs from 'fs';
import { app, safeStorage } from 'electron';
import levelup from 'levelup';
import leveldown from 'leveldown';
import encode from 'encoding-down';


/**
 * Returns false if encryption/decryption APIs are not available.
 * This would mean the encryption flag
 * would cause load/store calls to throw.
 */
export async function encryptionIsAvailable(): Promise<boolean> {
  return safeStorage.isEncryptionAvailable();
}


interface StateStorageOptions {
  /**
   * Whether to use encryption. Use for sensitive data.
   *
   * If specified when storing state, JSON representation of state
   * will be encrypted using EDlectron’s safeStorage API.
   *
   * If set to true when storing state, MUST be set to true
   * when retrieving that state.
   *
   * If encryption API is not available, but this flag is provided,
   * the call will throw.
   *
   * Default is `false`.
   */
  encrypted?: boolean,
}



export async function loadState<S extends Record<string, any>>(
  key: string,
  opts?: StateStorageOptions,
): Promise<S | undefined> {
  if (opts?.encrypted && !(await encryptionIsAvailable())) {
    throw new Error("Unable to load state: safe storage API is not available");
  }

  let result: unknown;
  try {
    if (!opts?.encrypted) {
      result = await stateStorage.get(key);
    } else {
      result = await stateStorage.get(key, { encoding: 'binary' });
    }
  } catch (e) {
    if ((e as any).type === 'NotFoundError') {
      return undefined;
    } else {
      throw e;
    }
  }
  if (!opts?.encrypted || !result) {
    return result as S | undefined;
  } else {
    try {
      return JSON.parse(safeStorage.decryptString(result as Buffer));
    } catch (e) {
      return undefined;
    }
  }
}


export async function storeState<S extends Record<string, any>>(
  key: string,
  newState: S,
  opts?: StateStorageOptions,
) {
  if (!opts?.encrypted) {
    await stateStorage.put(key, newState);
  } else {
    if (!(await encryptionIsAvailable())) {
      throw new Error("Unable to store state: safe storage API is not available");
    }
    await stateStorage.put(
      key,
      safeStorage.encryptString(JSON.stringify(newState)),
      { encoding: 'binary' },
    );
  }
}


export async function resetState(key: string) {
  await stateStorage.del(key);
}


export async function resetStateGlobal() {
  await stateStorage.clear();
  fs.rmdirSync(STATE_STORAGE_PATH, { recursive: true });
}
const STATE_STORAGE_PATH = path.join(app.getPath('userData'), 'state');
const stateStorage = levelup(encode(leveldown(STATE_STORAGE_PATH), {
  keyEncoding: 'string',
  valueEncoding: 'json',
}));
