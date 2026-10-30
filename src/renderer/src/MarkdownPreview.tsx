import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type {
  ProjectBrowser,
  ProjectEntry,
} from "../../shared/project-browser";
import { projectImageType } from "../../shared/project-browser";
import { richMarkdown } from "./RichContent";
import { useProjectResource } from "./useProjectResource";
import "./markdown-preview.css";

/**
 * 把文档内的图片地址解析为本地文件路径。
 * @param document [in] Markdown 文件路径，相对地址以其所在目录为基准。
 * @param source [in] 图片原始地址。
 * @returns 本地路径；网络、data 等协议或无法解码时返回 undefined。
 */
export function markdownImagePath(
  document: string,
  source: string,
): string | undefined {
  const target = source.replace(/[?#].*$/, "");
  if (!target) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target))
    return undefined;
  let decoded: string;
  try {
    decoded = decodeURI(target);
  } catch {
    return undefined;
  }
  const normalized = decoded.replace(/\\/g, "/");
  const absolute = /^([a-z]:)?\//i.test(normalized);
  const segments = absolute
    ? []
    : document.replace(/\\/g, "/").split("/").slice(0, -1);
  normalized.split("/").forEach((part, index) => {
    if (part === "..") {
      // 保留盘符或根目录，不越过文件系统根。
      if (segments.length > 1) segments.pop();
    } else if (part !== "." && (part !== "" || index === 0)) {
      segments.push(part);
    }
  });
  return segments.join("/");
}

/** 通过桌面图片接口读取本地图片，不让渲染进程直接请求文件或网络。 */
function PreviewImage({
  path,
  alt,
  browser,
  revision,
}: {
  readonly path: string;
  readonly alt?: string;
  readonly browser: ProjectBrowser;
  readonly revision: number;
}) {
  const resource = useProjectResource(browser.readProjectImage, path, revision);
  if (resource.status === "ready")
    return (
      <img
        className="markdown-preview-image"
        src={`data:${resource.value.mimeType};base64,${resource.value.data}`}
        alt={alt ?? ""}
      />
    );
  return (
    <span className="markdown-preview-image-note">
      {resource.status === "loading"
        ? `[正在读取图片${alt ? `：${alt}` : ""}]`
        : `[图片无法显示：${resource.error}]`}
    </span>
  );
}

/**
 * 以 Markdown Preview Enhanced 默认浅色主题呈现文件内容。
 * @param props [in] text：完整 Markdown 正文；file：所属文件，用于解析相对图片；browser：桌面文件接口；revision：刷新版本。
 * @returns 不执行原始 HTML、只加载本地图片的预览文档。
 */
export function MarkdownPreview({
  text,
  file,
  browser,
  revision,
}: {
  readonly text: string;
  readonly file: ProjectEntry;
  readonly browser: ProjectBrowser;
  readonly revision: number;
}) {
  const components = useMemo<Components>(
    () => ({
      ...richMarkdown.components,
      img: ({ src, alt }) => {
        const path =
          typeof src === "string"
            ? markdownImagePath(file.path, src)
            : undefined;
        return path && projectImageType(path) ? (
          <PreviewImage
            path={path}
            alt={alt}
            browser={browser}
            revision={revision}
          />
        ) : (
          <span className="markdown-preview-image-note">
            [图片未加载{alt ? `：${alt}` : ""}；仅显示本地图片]
          </span>
        );
      },
    }),
    [file.path, browser, revision],
  );
  return (
    <article className="markdown-preview rich-content">
      <ReactMarkdown
        remarkPlugins={richMarkdown.remarkPlugins}
        rehypePlugins={richMarkdown.rehypePlugins}
        components={components}
        urlTransform={richMarkdown.urlTransform}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}
