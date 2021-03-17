import keytar from 'keytar';
import log from 'electron-log';


// Auth helpers
/* Fetches password associated with the hostname of given remote URL
   (or, if that fails, with full remote URL)
   and with given username.

   Returns { username, password }; password can be undefined. */
export async function getAuth(remote: string, username: string): Promise<{ password: string | undefined; username: string; }> {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: getAuth: Likely malformed Git remote URL", remote);
    url = null;
  }

  let password: string | undefined;
  try {
    password =
      (url?.hostname ? await keytar.getPassword(url.hostname, username) : undefined) ||
      await keytar.getPassword(remote, username) ||
      undefined;
  } catch (e) {
    log.error("Repositories: Error retrieving password using keytar", remote, username, e);
    password = undefined;
  }

  return { password, username };
}


export async function saveAuth(remote: string, username: string, password: string) {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: savePassword: Likely malformed Git remote URL", remote);
    url = null;
  }

  const service = url?.hostname ? url.hostname : remote;
  try {
    await keytar.setPassword(service, username, password);
  } catch (e) {
    log.error("Repositories: Error saving password using keytar", remote, username, e);
    throw e;
  }
}
