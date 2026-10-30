import { join, resolve } from "node:path";
import type {
  ProjectBrowser,
  ProjectEntry,
  ProjectImage,
} from "../shared/project-browser";
import { projectImageType } from "../shared/project-browser";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type FileSystem = Pick<
  typeof import("node:fs/promises"),
  "readdir" | "open" | "stat"
>;

function entryKind(info: { isDirectory(): boolean; isFile(): boolean }) {
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  return "other";
}

function compareEntries(left: ProjectEntry, right: ProjectEntry): number {
  if (left.kind !== right.kind) {
    if (left.kind === "directory") return -1;
    if (right.kind === "directory") return 1;
  }
  return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
}

async function listDirectory(fs: FileSystem, path: string) {
  const directory = resolve(path);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = await Promise.all(
    entries.map(async (entry): Promise<ProjectEntry> => {
      const path = join(directory, entry.name);
      const info = entry.isSymbolicLink() ? await fs.stat(path) : entry;
      return { name: entry.name, path, kind: entryKind(info) };
    }),
  );
  return result.sort(compareEntries);
}

async function readFile(fs: FileSystem, path: string): Promise<string> {
  const file = await fs.open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("所选路径不是普通文件");
    const bytes = await file.readFile();
    return decodeProjectText(bytes);
  } finally {
    await file.close();
  }
}

async function readImage(fs: FileSystem, path: string): Promise<ProjectImage> {
  const mimeType = projectImageType(path);
  if (!mimeType) throw new Error("此文件不是受支持的图片格式");
  const file = await fs.open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("所选路径不是普通文件");
    if (info.size > MAX_IMAGE_BYTES)
      throw new Error("图片超过 20 MiB，无法在侧栏预览");
    const bytes = await file.readFile();
    return {
      mimeType,
      data: bytes.toString("base64"),
      byteSize: bytes.length,
    };
  } finally {
    await file.close();
  }
}

export function decodeProjectText(bytes: Uint8Array): string {
  if (bytes.includes(0))
    throw new Error("此文件是二进制文件，无法作为源码显示");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("此文件不是有效的 UTF-8 文本，无法作为源码显示", {
      cause: error,
    });
  }
}

/** 文件系统由桌面入口注入；不引用引擎、会话状态或工具执行记录。 */
export function createProjectBrowser(fs: FileSystem): ProjectBrowser {
  return {
    listProjectDirectory: (path) => listDirectory(fs, path),
    readProjectFile: (path) => readFile(fs, path),
    readProjectImage: (path) => readImage(fs, path),
  };
}
