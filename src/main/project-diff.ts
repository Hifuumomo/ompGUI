import { relative } from "node:path";
import type { ChangeObject } from "diff";
import type {
  ProjectDiff,
  ProjectDiffRequest,
  ProjectDiffRow,
} from "../shared/project-browser";
import { gitOutput, type RunGit } from "./project-git";
import { decodeProjectText } from "./project-browser";

export interface ProjectDiffDependencies {
  readonly run: RunGit;
  readonly read: (path: string) => Promise<string>;
  readonly lstat: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
  readonly readlink: (path: string) => Promise<string>;
  readonly compare: (
    before: string,
    after: string,
  ) => Promise<readonly ChangeObject<string>[]>;
}

async function readBefore(
  run: RunGit,
  request: ProjectDiffRequest,
): Promise<string> {
  if (!request.base) return "";
  const path = relative(
    request.cwd,
    request.file.previousPath ?? request.file.path,
  ).replaceAll("\\", "/");
  const tree = await gitOutput(run, request.cwd, [
    "ls-tree",
    "-z",
    request.base,
    "--",
    path,
  ]);
  if (!tree.length) return "";
  const entry = /^(\d+) (\w+) ([a-f\d]+)\t/.exec(tree.toString("utf8"));
  if (!entry || entry[2] !== "blob")
    throw new Error("此 Git 条目不是文本文件，无法逐行比较");
  return decodeProjectText(
    await gitOutput(run, request.cwd, ["cat-file", "blob", entry[3]]),
  );
}

async function readAfter(
  deps: ProjectDiffDependencies,
  request: ProjectDiffRequest,
) {
  try {
    const path = request.file.path;
    // Git 的符号链接 blob 存储链接目标，不能读取目标文件内容来比较。
    return (await deps.lstat(path)).isSymbolicLink()
      ? await deps.readlink(path)
      : await deps.read(path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      request.file.change === "deleted"
    )
      return "";
    throw error;
  }
}

function diffRows(
  parts: readonly ChangeObject<string>[],
): readonly ProjectDiffRow[] {
  let oldLine = 1;
  let newLine = 1;
  return parts.flatMap((part) => {
    const lines = part.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    return lines.map((line): ProjectDiffRow => ({
      kind: part.added ? "addition" : part.removed ? "deletion" : "context",
      text: line.replace(/\r?\n$/, ""),
      ending: line.endsWith("\n") ? "\n" : "",
      oldLine: part.added ? undefined : oldLine++,
      newLine: part.removed ? undefined : newLine++,
    }));
  });
}

export async function readDiff(
  deps: ProjectDiffDependencies,
  request: ProjectDiffRequest,
): Promise<ProjectDiff> {
  // 两侧都排空后再报告错误，避免失败返回时仍有 Git 子进程占用目录。
  const [before, after] = await Promise.allSettled([
    readBefore(deps.run, request),
    readAfter(deps, request),
  ]);
  if (before.status === "rejected") throw before.reason;
  if (after.status === "rejected") throw after.reason;
  return {
    before: before.value,
    after: after.value,
    rows: diffRows(await deps.compare(before.value, after.value)),
  };
}
