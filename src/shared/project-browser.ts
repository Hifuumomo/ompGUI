export interface ProjectEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "file" | "other";
  readonly change?: ProjectChangeKind;
  readonly previousPath?: string;
}

export type ProjectChangeKind =
  "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict";
export interface ProjectChanges {
  readonly kind: "git" | "plain";
  readonly root: string;
  readonly base: string | null;
  readonly files: readonly ProjectEntry[];
}
export interface ProjectDiffRequest {
  readonly cwd: string;
  readonly base: string | null;
  readonly file: ProjectEntry;
}
export interface ProjectDiffRow {
  readonly kind: "context" | "addition" | "deletion";
  readonly text: string;
  readonly ending: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}
export interface ProjectDiff {
  readonly before: string;
  readonly after: string;
  readonly rows: readonly ProjectDiffRow[];
}
export interface ProjectReview {
  listProjectChanges(cwd: string): Promise<ProjectChanges>;
  readProjectDiff(request: ProjectDiffRequest): Promise<ProjectDiff>;
}

/** 项目浏览仅通过桌面文件接口完成，不需要会话或 OMP RPC。 */
export interface ProjectBrowser {
  listProjectDirectory(path: string): Promise<readonly ProjectEntry[]>;
  readProjectFile(path: string): Promise<string>;
  /** 读取白名单格式的图片字节；非图片、超限或非普通文件明确拒绝。 */
  readProjectImage(path: string): Promise<ProjectImage>;
}

export interface ProjectImage {
  readonly mimeType: string;
  readonly data: string; // base64 编码的完整文件字节。
  readonly byteSize: number;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** 按扩展名判定可预览图片；返回 MIME，非图片返回 undefined。 */
export function projectImageType(path: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension && Object.hasOwn(IMAGE_TYPES, extension)
    ? IMAGE_TYPES[extension]
    : undefined;
}

/** 可在文件侧栏渲染预览的文档类型；其余文件只显示源码。 */
export type ProjectPreviewKind = "markdown" | "html";

const PREVIEW_TYPES: Record<string, ProjectPreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  html: "html",
  htm: "html",
};

/** 按扩展名判定预览类型；不可预览返回 undefined。 */
export function projectPreviewKind(
  path: string,
): ProjectPreviewKind | undefined {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension && Object.hasOwn(PREVIEW_TYPES, extension)
    ? PREVIEW_TYPES[extension]
    : undefined;
}
