import type { Changeset, PathChanges } from '@riboseinc/paneron-extension-kit/types/changes';


/**
 * Returns given async function wrapped in such a way that it will
 * only execute one at a time,
 * waiting for previous invocation to complete if it’s ongoing.
 * (Doesn’t care whether previous invocation succeeds,
 * the call will be scheduled regardless.)
 */
export function makeSequential
<T, A extends unknown[]>
(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let workQueue: Promise<void> = Promise.resolve();
  return (...args) => {
    const call = () => fn(...args);
    const result = workQueue.then(call, call);
    workQueue = result.then(ignore, ignore);
    return result;
  };
}
const ignore = (_: any) => {};



export function changesetToPathChanges(
  changeset: Changeset<any>,
): PathChanges {
  const changes: PathChanges = {};
  for (const [path, change] of Object.entries(changeset)) {
    if (change.newValue === null && change.oldValue === null) {
      throw new Error("Encountered a non-change in a changeset");
    } else if (change.newValue === null && change.oldValue !== null) {
      changes[path] = 'removed';
    } else if (change.newValue !== null && change.oldValue === null) {
      changes[path] = 'added';
    } else if (change.newValue !== change.oldValue) {
      changes[path] = 'modified';
    }
  }
  return changes;
}


// function changedPathsToPathChanges(
//   changedPaths: [path: string, change: ChangeStatus][]
// ): PathChanges {
//   const pathChanges: PathChanges = changedPaths.
//     map(([path, change]) => ({ [path]: change })).
//     reduce((prev, curr) => ({ ...prev, ...curr }));
//   return pathChanges;
// }


export function forceSlug(val: string): string {
  return val.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
}


export function stripLeadingSlash(aPath: string): string {
  return aPath.replace(/^\//, '');
}


export function stripTrailingSlash(aPath: string): string {
  return aPath.replace(/\/$/, '');
}


export function toJSONPreservingUndefined(data: any) {
  return (JSON.
    stringify(
      data || {},
      (_, v) => (v === undefined) ? '__undefined' : v).
    replace(/\"__undefined\"/g, 'undefined'));
}
