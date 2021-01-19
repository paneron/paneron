import { resolve, relative } from 'path';
import fs, { readdir } from 'fs/promises';
import git, { WalkerEntry } from 'isomorphic-git';
import { ChangeStatus } from '@riboseinc/paneron-extension-kit/types/buffers';
import { stripLeadingSlash } from 'utils';


/* Streams paths that are descendants of given root path
   as slash-prepended strings relative to root path.

   root should be absolute path.

   If root path is not a directory, yields the only string '/'.

   Uses filesystem, so may report data or changes unknown to Git.
*/
export async function* listDescendantPaths(
  root: string,
): AsyncGenerator<string> {
  const rootStat = await fs.lstat(root);
  if (rootStat.isDirectory()) {
    const dirents = await readdir(root, { withFileTypes: true });
    for (const dirent of dirents) {
      const resolvedPath = resolve(root, dirent.name);
      if (dirent.isDirectory()) {
        yield* listDescendantPaths(resolvedPath);
      } else {
        yield `/${relative(root, resolvedPath)}`;
      }
    }
  } else {
    yield '/';
  }
}


/* Yields paths that are descendants of given root path
   as slash-prepended strings relative to root path.

   Requires workDir, which must be a root of Git repository.
   root should be relative to workDir.

   Only returns paths found at given ref (repository commit).

   Optionally can return change status of the path
   relative to another commit. If `opts.onlyChanged` is also specified,
   will not return paths that are unchanged.

   Returns a promise that resolves with a list of all found paths at once.

   Since this uses Git and is not a generator
   (due to underlying Isomorphic Git API restrictions),
   this is slower than plain listDescendantPaths and uses more memory.
   On the other hand, it will not include untracked files.

   If root path is not a directory, yields the only string '/'.
*/
export async function listDescendantPathsAtVersion(
  root: string,
  workDir: string,
  ref: string,
  diffOpts?: { refToCompare: string, onlyChanged: boolean },
): Promise<[ path: string, status: ChangeStatus | null ][]> {

  const ref2 = diffOpts?.refToCompare || ref;
  const doCompare = ref2 !== ref;

  const rootWithoutLeadingSlash = stripLeadingSlash(root);
  const rootWithLeadingSlash = `/${rootWithoutLeadingSlash}`;

  return git.walk({
    fs,
    dir: workDir,
    trees: [git.TREE({ ref }), git.TREE({ ref: ref2 })],
    map: async function (filepath, walkerEntry) {
      // Note: filepath is not expected to have leading slash.

      if (walkerEntry === null) {
        return;
      }
      if (filepath === '.') {
        return;
      }
      if (!filepath.startsWith(rootWithoutLeadingSlash)) {
        return;
      }

      const [A, B] = walkerEntry as (WalkerEntry | null)[];

      // Skip directories
      // TODO: Check type !== 'blob' instead?
      if ((await A?.type()) === 'tree' || (await B?.type()) === 'tree') {
        return;
      }

      const filepathWithLeadingSlash = `/${filepath}`;
      const relativeFilepath = relative(rootWithLeadingSlash, filepathWithLeadingSlash);

      if (doCompare) {
        const Aoid = await A?.oid();
        const Boid = await B?.oid();

        let changeStatus: ChangeStatus;
        if (Aoid === Boid) {
          if (Aoid === undefined && Boid === undefined) {
            // Well this would be very unexpected!
          }
          // Buffer at this path did not change.
          if (diffOpts?.onlyChanged !== true) {
            changeStatus = 'unchanged';
          } else {
            return;
          }
        } else if (Aoid === undefined) {
          changeStatus = 'added';
        } else if (Boid === undefined) {
          changeStatus = 'removed';
        } else {
          changeStatus = 'modified';
        }

        return [relativeFilepath, changeStatus];
      } else {
        return [relativeFilepath, null];
      }
    },
  });
}



/* Given two commits, returns a big flat object of paths
   (slash-prepended, relative to workDir)
   and their change statuses (type ChangeStatus) between those commits.

   Uses Isomorphic Git tree walker to iterate,
   so will not include files unknown to Git.

   If opts.onlyChanged is true, returned change statuses will not contain ‘unchanged’
   (and path list will not be exhaustive).

   NOTE: Deprecated.
*/
export async function listBufferStatuses
(oid1: string, oid2: string, workDir: string, opts?: { onlyChanged?: boolean }):
Promise<Record<string, ChangeStatus>> {
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

      let type: ChangeStatus;
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
