import { basename, dirname, join, resolve } from "node:path";
import type {
  ProjectChangeKind,
  ProjectChanges,
  ProjectEntry,
} from "../shared/project-browser";
import { gitOutput, type RunGit } from "./project-git";

export type ProjectStat = typeof import("node:fs/promises").stat;

async function repositoryDirectory(
  cwd: string,
  stat: ProjectStat,
): Promise<string | null> {
  if (!(await stat(cwd)).isDirectory()) throw new Error("项目路径不是目录");
  let directory = resolve(cwd);
  while (true) {
    try {
      await stat(join(directory, ".git"));
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function changeKind(status: string): ProjectChangeKind {
  if (status.includes("U") || status === "AA" || status === "DD")
    return "conflict";
  if (status === "??") return "untracked";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  if (status.includes("A")) return "added";
  return "modified";
}

/** porcelain -z 的路径未转义，重命名记录先给目标，再给旧路径。 */
export function parseProjectChanges(
  output: string,
  root: string,
): readonly ProjectEntry[] {
  const fields = output.split("\0");
  const files = new Map<string, ProjectEntry>();
  for (let index = 0; index < fields.length - 1; index += 1) {
    const record = fields[index];
    const status = record.slice(0, 2);
    const path = resolve(root, record.slice(3));
    const previousPath = /[RC]/.test(status)
      ? resolve(root, fields[++index])
      : undefined;
    const previous = files.get(path);
    const change = previous ? "modified" : changeKind(status);
    files.set(path, {
      name: basename(path),
      path,
      kind: "file",
      change,
      previousPath,
    });
  }
  return [...files.values()];
}

export async function listChanges(
  deps: { readonly stat: ProjectStat; readonly run: RunGit },
  cwd: string,
): Promise<ProjectChanges> {
  const root = await repositoryDirectory(cwd, deps.stat);
  if (!root)
    return { kind: "plain", root: resolve(cwd), base: null, files: [] };
  const head = await deps.run(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD",
  ]);
  if (head.code !== 0 && head.code !== 1) throw new Error(head.stderr);
  const output = await gitOutput(deps.run, cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--renames",
    "--",
    ".",
  ]);
  return {
    kind: "git",
    root,
    base: head.code === 0 ? head.stdout.toString("utf8").trim() : null,
    files: parseProjectChanges(output.toString("utf8"), root),
  };
}
