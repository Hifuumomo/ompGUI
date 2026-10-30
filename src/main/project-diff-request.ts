import type {
  ProjectDiffRequest,
  ProjectEntry,
} from "../shared/project-browser";

/** 在 IPC 边界验证实际用于文件/Git 读取的字段。 */
export function projectDiffRequest(input: unknown): ProjectDiffRequest {
  if (!input || typeof input !== "object")
    throw new Error("差异请求必须是对象");
  const { cwd, base, file } = input as ProjectDiffRequest;
  if (typeof cwd !== "string" || !cwd.trim()) throw new Error("缺少项目目录");
  if (base !== null && (typeof base !== "string" || !/^[a-f\d]+$/.test(base)))
    throw new Error("无效的 Git 基线");
  if (!file || typeof file.path !== "string" || !file.path.trim())
    throw new Error("缺少差异文件路径");
  if (file.previousPath !== undefined && typeof file.previousPath !== "string")
    throw new Error("无效的原文件路径");
  const entry: ProjectEntry = {
    name: file.name,
    path: file.path,
    kind: "file",
    previousPath: file.previousPath,
    change: file.change,
  };
  return { cwd, base, file: entry };
}
