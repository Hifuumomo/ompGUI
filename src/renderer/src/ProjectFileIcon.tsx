import type { ProjectChangeKind } from "../../shared/project-browser";
import "./project-file-icons.css";

const FILE_TYPES: Readonly<Record<string, readonly [string, string]>> = {
  js: ["JS", "javascript"],
  mjs: ["JS", "javascript"],
  cjs: ["JS", "javascript"],
  ts: ["TS", "typescript"],
  mts: ["TS", "typescript"],
  cts: ["TS", "typescript"],
  css: ["#", "css"],
  scss: ["#", "css"],
  json: ["{}", "javascript"],
  html: ["‹›", "html"],
  xml: ["‹›", "html"],
  svg: ["◇", "html"],
  c: ["C", "cpp"],
  cpp: ["C⁺", "cpp"],
  cc: ["C⁺", "cpp"],
  h: ["H", "cpp"],
  hpp: ["H", "cpp"],
  md: ["ⓘ", "markdown"],
  txt: ["≡", "text"],
  yaml: ["Y", "yaml"],
  yml: ["Y", "yaml"],
};
const STATUS: Readonly<Record<ProjectChangeKind, readonly [string, string]>> = {
  added: ["新增", "+"],
  untracked: ["未跟踪（新增）", "+"],
  modified: ["修改", "•"],
  deleted: ["删除", "−"],
  renamed: ["重命名", "→"],
  conflict: ["冲突", "!"],
};

function PythonIcon() {
  return (
    <svg
      className="project-type-icon python"
      viewBox="0 0 24 24"
      aria-label="Python 文件"
      role="img"
    >
      <path
        fill="currentColor"
        d="M12 2c-5 0-5 2-5 5h6v1H5c-4 0-4 9 0 9h1v-4c0-2 1-3 3-3h6c2 0 3-1 3-3V5c0-2-2-3-6-3Z"
      />
      <path
        fill="currentColor"
        opacity=".7"
        d="M12 22c5 0 5-2 5-5h-6v-1h8c4 0 4-9 0-9h-1v4c0 2-1 3-3 3H9c-2 0-3 1-3 3v2c0 2 2 3 6 3Z"
      />
      <circle fill="white" cx="10" cy="5" r="1" />
      <circle fill="white" cx="14" cy="19" r="1" />
    </svg>
  );
}
function ReactIcon() {
  return (
    <svg
      className="project-type-icon react"
      viewBox="-12 -12 24 24"
      aria-label="React 文件"
      role="img"
      fill="none"
      stroke="currentColor"
    >
      <circle r="2" fill="currentColor" stroke="none" />
      <ellipse rx="11" ry="4" />
      <ellipse rx="11" ry="4" transform="rotate(60)" />
      <ellipse rx="11" ry="4" transform="rotate(120)" />
    </svg>
  );
}
/** 消息文件链接使用同色图标：文档为折角纸张，C/C++ 源码为六边形徽标。 */
function FileLinkIcon({ extension }: { readonly extension: string }) {
  const cpp = /^(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(extension);
  return (
    <svg
      className="file-link-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-file-kind={cpp ? "cpp" : "document"}
    >
      {cpp ? (
        <>
          <path fill="currentColor" d="M12 1 22 6.5v11L12 23 2 17.5v-11Z" />
          <path
            d="M10.5 8.8a4 4 0 1 0 0 6.4M14 10v4m-2-2h4m3-2v4m-2-2h4"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function ProjectFileIcon({
  path,
  variant = "tree",
}: {
  readonly path: string;
  readonly variant?: "tree" | "link";
}) {
  const extension = path.split(".").at(-1)!.toLowerCase();
  if (variant === "link") return <FileLinkIcon extension={extension} />;
  if (extension === "py" || extension === "pyi") return <PythonIcon />;
  if (extension === "tsx" || extension === "jsx") return <ReactIcon />;
  const [label, color] = FILE_TYPES[extension] ?? ["≡", "text"];
  return (
    <span
      className={`project-type-icon ${color}`}
      role="img"
      aria-label={`${extension} 文件`}
    >
      {label}
    </span>
  );
}
export function ProjectChangeIcon({
  change,
}: {
  readonly change?: ProjectChangeKind;
}) {
  if (!change) return null;
  const [label, symbol] = STATUS[change];
  return (
    <span
      className={`project-change-icon ${change}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {symbol}
    </span>
  );
}
