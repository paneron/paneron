import nodePath from 'path';
import fs from 'fs';
import git, { type WalkerEntry } from 'isomorphic-git';
import type { ChangeStatus, DiffStatus } from '@riboseinc/paneron-extension-kit/types/changes';
import { stripLeadingSlash } from '../../../utils';
import { posixifyPath } from '../../../main/fs-utils';
import type { Repositories } from '../types';


const { lstat, readdir } = fs.promises;


export const resolveChanges: Repositories.Data.ResolveChanges = async ({ workDir, rootPath, oidBefore, oidAfter }) => {
  if (!(await git.isDescendent({ fs, dir: workDir, oid: oidAfter, ancestor: oidBefore }))) {
    throw new Error("Comparing commits: oidAfter is not a descendant of oidBefore");
  }
  return {
    changedBuffers: await listDescendantPathsAtVersion(rootPath, workDir, oidBefore, {
      refToCompare: oidAfter,
      onlyChanged: true,
    }) as [path: string, changeStatus: ChangeStatus][], // Type casting reflects the effect of onlyChanged
  };
}


/**
 * Streams paths that are descendants of given root filesystem path
 * as slash-prepended POSIX-style strings relative to root path.
 *
 * If root path is not a directory, yields one `/`.
 *
 * Root path must be system-absolute and platform-specific (win32 or POSIX).
 *
 * NOTE: Uses filesystem direct, so may return data or changes unknown to VCS.
 */
export async function * listDescendantPaths(
  /** Filesystem-absolute path. */
  root: string,

  /** Do not pass this, used during recursion. */
  originalRoot?: string,
): AsyncGenerator<string> {
  const rootStat = await lstat(root);
  if (rootStat.isDirectory()) {
    const dirents = await readdir(root, { withFileTypes: true });
    for (const dirent of dirents) {
      const resolvedPath = nodePath.resolve(root, dirent.name);
      if (dirent.isDirectory()) {
        yield * listDescendantPaths(resolvedPath, originalRoot ?? root);
      } else {
        yield `/${posixifyPath(nodePath.relative(originalRoot ?? root, resolvedPath))}`;
      }
    }
  } else {
    yield '/';
  }
}


/**
 * Yields repository subpaths that are descendants of given `root` path
 * as slash-prepended POSIX paths relative to `root`.
 *
 * Only returns paths found at given `ref` (repository commit).
 *
 * Optionally can compare change status of the path
 * relative to another commit. If `opts.onlyChanged` is also specified,
 * will not return paths that are unchanged.
 *
 * Returns a promise that resolves with a list of all found paths at once.
 *
 * Since this function uses Git storage, and is not a generator
 * (due to underlying Isomorphic Git API restrictions),
 * this *may* be more expensive than plain `listDescendantPaths()`.
 *
 * If root path is not a directory, yields the only string '/'.
 */
export async function listDescendantPathsAtVersion(
  /** POSIX-style repo-relative path. */
  root: string,
  /** Absolute local path to Git working directory root. */
  workDir: string,
  ref: string,
  diffOpts?: { refToCompare: string, onlyChanged: boolean },
): Promise<[ path: string, status: DiffStatus | null ][]> {

  const ref2 = diffOpts?.refToCompare || ref;
  const doCompare = ref2 !== ref;

  const rootWithoutLeadingSlash = stripLeadingSlash(root);
  const rootWithLeadingSlash = `/${rootWithoutLeadingSlash}`;

  return git.walk({
    fs,
    dir: workDir,
    trees: [git.TREE({ ref }), git.TREE({ ref: ref2 })],
    map: async function (filepath, walkerEntry) {
      if (walkerEntry === null) {
        return;
      }
      if (filepath === '.') {
        return;
      }

      const filepathWithoutLeadingSlash = stripLeadingSlash(filepath);
      const filepathWithLeadingSlash = `/${filepathWithoutLeadingSlash}`;

      if (!filepathWithLeadingSlash.startsWith(rootWithLeadingSlash)) {
        return;
      }

      const [A, B] = walkerEntry as (WalkerEntry | null)[];

      // Skip directories
      // TODO: Check type !== 'blob' instead?
      if ((await A?.type()) === 'tree' || (await B?.type()) === 'tree') {
        return;
      }

      const relativeFilepath = nodePath.posix.relative(rootWithLeadingSlash, filepathWithLeadingSlash);
      const relativeFilepathWithLeadingSlash = relativeFilepath ? `/${relativeFilepath}` : '/';

      if (doCompare) {
        const Aoid = await A?.oid();
        const Boid = await B?.oid();

        let diffStatus: DiffStatus;
        if (Aoid === Boid) {
          if (Aoid === undefined && Boid === undefined) {
            // Well this would be very unexpected!
          }
          // Buffer at this path did not change.
          if (diffOpts?.onlyChanged !== true) {
            diffStatus = 'unchanged';
          } else {
            return;
          }
        } else if (Aoid === undefined) {
          diffStatus = 'added';
        } else if (Boid === undefined) {
          diffStatus = 'removed';
        } else {
          diffStatus = 'modified';
        }

        return [relativeFilepathWithLeadingSlash, diffStatus];
      } else {
        return [relativeFilepathWithLeadingSlash, null];
      }
    },
  });
}



/**
 * Given two commits, returns a big flat object of paths
 * (slash-prepended, relative to workDir)
 * and their change statuses (type ChangeStatus) between those commits.
 *
 * Uses Isomorphic Git tree walker to iterate,
 * so will not include files unknown to Git.
 *
 * If opts.onlyChanged is true, returned change statuses will not contain ‘unchanged’
 * (and path list will not be exhaustive).
 *
 * @deprecated use `listDescendantPathsAtVersion()` with `diffOpts` instead.
 */
export async function listBufferStatuses
(oid1: string, oid2: string, workDir: string, opts?: { onlyChanged?: boolean }):
Promise<Record<string, DiffStatus>> {
  return git.walk({
    fs,
    dir: workDir,
    trees: [git.TREE({ ref: oid1 }), git.TREE({ ref: oid2 })],
    reduce: async function (parent, children) {
      const reduced = {
        ...(parent || {}),
        ...((children || []).reduce((p, c) => ({ ...p, ...c }), {})),
      };
      return reduced;
    },
    map: async function (filepath, walkerEntry) {
      if (walkerEntry === null) {
        return;
      }
      if (filepath === '.') {
        return;
      }

      const [A, B] = walkerEntry as (WalkerEntry | null)[];

      if ((await A?.type()) === 'tree' || (await B?.type()) === 'tree') {
        return;
      }

      const Aoid = await A?.oid();
      const Boid = await B?.oid();

      let type: DiffStatus;
      if (Aoid === Boid) {
        if (Aoid === undefined && Boid === undefined) {
          // Well this would be super unexpected!
        }
        // Buffer at this path did not change.
        if (opts?.onlyChanged !== true) {
          type = 'unchanged';
        } else {
          return;
        }
      } else if (Aoid === undefined) {
        type = 'added';
      } else if (Boid === undefined) {
        type = 'removed';
      } else {
        type = 'modified';
      }

      return { [`/${filepath}`]: type };
    },
  });
}
