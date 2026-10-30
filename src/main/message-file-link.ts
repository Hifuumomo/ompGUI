import { posix, win32 } from "node:path";
import { messageFilePath } from "../shared/message-file-link";
import type { ProjectEntry } from "../shared/project-browser";

/** 验证目标并区分目录；仅侧栏跳转允许缺失路径，文件操作仍须存在。 */
export async function inspectProjectFileLink(
  href: string,
  cwd: string,
  stat: typeof import("node:fs/promises").stat,
  allowMissing = false,
): Promise<ProjectEntry> {
  const entry = resolveProjectFileLink(href, cwd);
  let info;
  try {
    info = await stat(entry.path);
  } catch (error) {
    if (
      allowMissing &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return entry;
    throw new Error(`路径不存在或无法访问：${entry.path}`);
  }
  if (!info.isDirectory() && !info.isFile())
    throw new Error("所选路径不是普通文件或目录");
  return {
    ...entry,
    name: entry.name || entry.path,
    kind: info.isDirectory() ? "directory" : "file",
  };
}

/** 按会话工作目录解析用户点击的链接，仅返回文件位置，不启动程序或执行命令。 */
export function resolveProjectFileLink(
  href: string,
  cwd: string,
): ProjectEntry {
  const target = messageFilePath(href);
  if (!target) throw new Error("此链接不是支持的本地文件路径");
  const paths =
    /^[a-z]:[/\\]/i.test(target) || /^[a-z]:[/\\]/i.test(cwd) ? win32 : posix;
  if (!paths.isAbsolute(target) && !paths.isAbsolute(cwd))
    throw new Error("当前会话没有有效的工作目录，无法解析相对文件路径");
  const path = paths.resolve(cwd, target);
  return { name: paths.basename(path), path, kind: "file" };
}
