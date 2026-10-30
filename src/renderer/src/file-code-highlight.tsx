import type { ReactNode } from "react";
import hljs from "highlight.js/lib/common";
import type { CodeRow } from "./file-code-model";

export interface TokenRange {
  start: number;
  end: number;
  className: string;
}

const fileLanguages: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  md: "markdown",
  h: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  html: "xml",
  htm: "xml",
  svg: "xml",
  jsonl: "json",
};

/** 按真实文件名选择已安装的显式语法，不猜测正文语言。[in] path：文件路径。返回值：已注册语言或空字符串。 */
export function fileLanguage(path: string): string {
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : name;
  const language = fileLanguages[extension] ?? extension;
  return hljs.getLanguage(language) ? language : "";
}

/** 将可信高亮库输出转成文本区间，不挂载 HTML 或转发属性。[in] source：完整连续源码；[in] language：已注册显式语言。返回值：有序 UTF-16 token 区间。 */
export function tokenRanges(source: string, language: string): TokenRange[] {
  const html = hljs.highlight(source, { language, ignoreIllegals: true }).value;
  const template = document.createElement("template");
  // HTML 解析规范化字面 CR；字符引用保留原始 UTF-16 位置。
  template.innerHTML = html.replace(/\r/g, "&#13;");
  const tokens: TokenRange[] = [];
  let offset = 0;
  /** 遍历库生成的 span 树并继承跨行语法 class。[in] node：脱离文档的库节点；[in] classes：祖先 token class。返回值：无。 */
  function visit(node: Node, classes: string) {
    if (node.nodeType === Node.TEXT_NODE) {
      const end = offset + (node.textContent?.length ?? 0);
      if (classes && end > offset)
        tokens.push({ start: offset, end, className: classes });
      offset = end;
      return;
    }
    const own =
      node instanceof HTMLSpanElement
        ? Array.from(node.classList)
            .filter((name) => /^(?:hljs-[\w-]+|[\w-]+_)$/.test(name))
            .join(" ")
        : "";
    const inherited = [classes, own].filter(Boolean).join(" ");
    node.childNodes.forEach((child) => visit(child, inherited));
  }
  visit(template.content, "");
  return tokens;
}

/** 将整段 token 线性投影到原始前缀行，正文始终取自原文。[in] rows：前缀代码行；[in] source：完整连续原文；[in] ranges：有序 token 区间。返回值：带 token 装饰的新行数组。 */
export function applyTokens(
  rows: CodeRow[],
  source: string,
  ranges: TokenRange[],
): CodeRow[] {
  if (ranges.length === 0)
    return rows.map((row) => ({ ...row, tokens: undefined }));
  let rangeIndex = 0;
  let start = 0;
  const decorated: CodeRow[] = [];
  for (const row of rows) {
    const end = start + row.text.length + row.ending.length;
    const nodes: ReactNode[] = [];
    let position = start;
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= start)
      rangeIndex += 1;
    let index = rangeIndex;
    while (index < ranges.length && ranges[index].start < end) {
      const token = ranges[index];
      const tokenStart = Math.max(position, token.start);
      const tokenEnd = Math.min(end, token.end);
      if (tokenStart > position) nodes.push(source.slice(position, tokenStart));
      nodes.push(
        <span className={token.className} key={`${index}:${tokenStart}`}>
          {source.slice(tokenStart, tokenEnd)}
        </span>,
      );
      position = tokenEnd;
      if (token.end > end) break;
      index += 1;
    }
    if (position < end) nodes.push(source.slice(position, end));
    decorated.push({ ...row, tokens: nodes });
    rangeIndex = index;
    start = end;
  }
  return decorated;
}

/** 一次高亮差异同侧的连续片段，不按单行重启词法状态。[in] rows：同侧连续行；[in] language：显式语言。返回值：已高亮的新行数组。 */
function highlightRun(rows: CodeRow[], language: string) {
  if (!language || rows.length === 0) return rows;
  const source = rows.map((row) => row.text + row.ending).join("");
  return applyTokens(rows, source, tokenRanges(source, language));
}

/** 分别高亮差异两侧的连续真实行号片段，不补造省略上下文。[in] rows：真实差异行；[in] language：显式语言。返回值：保留原始证据的新装饰行数组。 */
export function highlightDiff(rows: CodeRow[], language: string) {
  const decorated = new Map<CodeRow, CodeRow>();
  /** 装饰连续片段并记录对应原始行，不修改输入行。[in] run：原始连续行。返回值：无。 */
  function storeRun(run: CodeRow[]) {
    const highlighted = highlightRun(run, language);
    run.forEach((row, index) => decorated.set(row, highlighted[index]));
  }
  for (const side of ["old", "new"] as const) {
    let run: CodeRow[] = [];
    let previous: number | undefined;
    for (const row of rows) {
      if (row.kind === "metadata") {
        storeRun(run);
        run = [];
        previous = undefined;
        continue;
      }
      if (side === "old" && row.kind === "addition") continue;
      if (side === "new" && row.kind === "deletion") continue;
      const number = Number(
        side === "old" ? (row.oldLine ?? row.line) : (row.newLine ?? row.line),
      );
      if (previous !== undefined && number !== previous + 1) {
        storeRun(run);
        run = [];
      }
      run.push(row);
      previous = number;
    }
    storeRun(run);
  }
  return rows.map((row) => decorated.get(row) ?? row);
}
