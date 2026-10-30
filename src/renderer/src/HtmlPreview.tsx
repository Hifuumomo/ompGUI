import { useEffect, useState } from "react";
import type {
  ProjectBrowser,
  ProjectEntry,
} from "../../shared/project-browser";
import { projectImageType } from "../../shared/project-browser";
import { markdownImagePath } from "./MarkdownPreview";
import "./html-preview.css";

/**
 * 内联文档引用的本地图片与样式表，移除脚本、base 与 meta 指令。
 * @param text [in] HTML 原文。
 * @param file [in] 所属文件，相对地址以其目录为基准。
 * @param browser [in] 桌面文件接口；读取失败的资源保持原地址，按浏览器缺失资源显示。
 * @returns 可放入沙箱 iframe 的完整文档。
 */
async function inlineDocument(
  text: string,
  file: ProjectEntry,
  browser: ProjectBrowser,
): Promise<string> {
  const doc = new DOMParser().parseFromString(text, "text/html");
  for (const node of doc.querySelectorAll("script, base, meta[http-equiv]"))
    node.remove();
  await Promise.all([
    ...[...doc.querySelectorAll("img[src]")].map(async (image) => {
      const path = markdownImagePath(file.path, image.getAttribute("src")!);
      if (!path || !projectImageType(path)) return;
      try {
        const data = await browser.readProjectImage(path);
        image.setAttribute("src", `data:${data.mimeType};base64,${data.data}`);
      } catch {
        /* 缺失图片按浏览器默认方式显示。 */
      }
    }),
    ...[...doc.querySelectorAll('link[rel~="stylesheet"][href]')].map(
      async (link) => {
        const path = markdownImagePath(file.path, link.getAttribute("href")!);
        if (!path || !/\.css$/i.test(path)) return;
        try {
          const style = doc.createElement("style");
          style.textContent = await browser.readProjectFile(path);
          link.replaceWith(style);
        } catch {
          /* 缺失样式表时按无样式渲染。 */
        }
      },
    ),
  ]);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/**
 * 在无脚本、无同源权限的沙箱 iframe 中显示 HTML 的浏览器渲染效果。
 * @param props [in] text：HTML 原文；file：所属文件；browser：桌面文件接口；revision：刷新版本，变化时重新读取引用资源。
 * @returns 渲染预览或读取状态。
 */
export function HtmlPreview({
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
  const [result, setResult] = useState<{
    readonly key: string;
    readonly html?: string;
    readonly error?: string;
  }>();
  const key = `${file.path}\u0000${revision}\u0000${text}`;
  useEffect(() => {
    let active = true;
    inlineDocument(text, file, browser).then(
      (html) => active && setResult({ key, html }),
      (error: unknown) =>
        active &&
        setResult({
          key,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, [key, text, file, browser]);
  if (result?.key !== key) return <p role="status">正在准备渲染预览…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return (
    <iframe
      className="html-preview"
      title={`${file.name} 渲染预览`}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={result.html}
    />
  );
}
