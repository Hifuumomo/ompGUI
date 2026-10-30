import { createContext, useContext, useEffect, useState } from "react";
import { splitLines } from "./inline-detail-limits";

/**
 * 工具输出里的文件路径与网址识别：识别是纯函数，不访问文件系统；
 * 存在性确认由 OutputFileProbe 注入，确认前和失败时都保持纯文本。
 */

/** 输出类型：shell 只认结构化位置与 git 状态行，search 按行解析 路径[:行[:列]]。 */
export type OutputMode = "shell" | "search";

/** 输出片段：path 为可能的文件路径，url 为网址，location 为搜索结果中的行列号。 */
export interface OutputPiece {
  text: string;
  path?: string;
  url?: string;
  location?: boolean;
}

/** 每段输出最多确认的候选路径数，超出的保持纯文本。 */
export const MAX_OUTPUT_CANDIDATES = 200;

/** 确认路径在当前项目中是否为真实文件；由 App 按会话目录提供，缺省时输出不渲染文件链接。 */
export const OutputFileProbe = createContext<
  ((path: string) => Promise<boolean>) | undefined
>(undefined);

const PATH_CHARS = String.raw`[\p{L}\p{N}_.@~+\-/\\]`;
const DRIVE = String.raw`(?:[A-Za-z]:)?`;
// path(行,列) 或 path:行[:列]；路径前不能紧跟路径字符，避免从单词中间开始匹配。
const LOCATED_PATH = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.@~+\-/\\:])(${DRIVE}${PATH_CHARS}+)(?:\((\d+),(\d+)\)|:(\d+)(?::(\d+))?)(?!\d)`,
  "gu",
);
const SEARCH_LINE = new RegExp(
  String.raw`^(\s*)(${DRIVE}${PATH_CHARS}+)(?::(\d+)(?::(\d+))?)?(.*)$`,
  "u",
);
const GIT_STATUS = /^( ?[MADRCUT?!]{1,2}[ \t]+)(\S+)(?: -> (\S+))?$/;
const GIT_STAT = /^( *)(\S+)( +\| +(?:\d|Bin\b).*)$/;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** 路径必须带目录分隔符和扩展名，排除 console.log、提交哈希、版本号等误判。[in] path：候选路径。返回值：是否像文件路径。 */
export function isFilePath(path: string): boolean {
  if (!path || /\s/.test(path) || !/[\\/]/.test(path)) return false;
  const name = path.split(/[\\/]/).pop() ?? "";
  return /^.+\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(name);
}

/** 去掉网址末尾的标点和不成对的括号。[in] url：匹配到的原文。返回值：修剪后的网址。 */
function trimUrl(url: string): string {
  let value = url.replace(/[.,;:!?]+$/, "");
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  while (value && pairs[value.at(-1)!]) {
    const close = value.at(-1)!;
    const opened = value.split(pairs[close]).length - 1;
    const closed = value.split(close).length - 1;
    if (closed <= opened) break;
    value = value.slice(0, -1).replace(/[.,;:!?]+$/, "");
  }
  return value;
}

/** 合并相邻的纯文本片段并丢弃空片段。[in] pieces：原始片段。返回值：合并后的新数组。 */
function mergeText(pieces: readonly OutputPiece[]): OutputPiece[] {
  const plain = (piece: OutputPiece) =>
    piece.path === undefined && piece.url === undefined && !piece.location;
  const merged: OutputPiece[] = [];
  for (const piece of pieces) {
    if (!piece.text) continue;
    const last = merged.at(-1);
    if (last && plain(last) && plain(piece)) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged;
}

/** 识别一段文本中的 path(行,列) 与 path:行[:列]。[in] text：不含网址的文本。返回值：片段。 */
function locatedPieces(text: string): OutputPiece[] {
  const pieces: OutputPiece[] = [];
  let offset = 0;
  for (const match of text.matchAll(LOCATED_PATH)) {
    const path = match[1];
    if (!isFilePath(path)) continue;
    const start = match.index;
    pieces.push({ text: text.slice(offset, start) });
    pieces.push({ text: path, path });
    pieces.push({ text: text.slice(start + path.length, start + match[0].length) });
    offset = start + match[0].length;
  }
  pieces.push({ text: text.slice(offset) });
  return pieces;
}

/** 先切出网址，再在其余文本中识别带位置的路径。[in] line：不含换行的一行。返回值：片段。 */
function scanLine(line: string): OutputPiece[] {
  const pieces: OutputPiece[] = [];
  let offset = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!url) continue;
    pieces.push(...locatedPieces(line.slice(offset, match.index)));
    pieces.push({ text: url, url });
    offset = match.index + url.length;
  }
  pieces.push(...locatedPieces(line.slice(offset)));
  return pieces;
}

/**
 * 解析 Shell 输出的一行：git 状态行、git diff --stat 行，其余只认带位置的路径与网址。
 * [in] line：不含换行的一行。返回值：片段，拼接后与原文一致。
 */
export function parseShellLine(line: string): OutputPiece[] {
  const status = GIT_STATUS.exec(line);
  if (status && isFilePath(status[2]) && (!status[3] || isFilePath(status[3]))) {
    const pieces: OutputPiece[] = [
      { text: status[1] },
      { text: status[2], path: status[2] },
    ];
    if (status[3]) pieces.push({ text: " -> " }, { text: status[3], path: status[3] });
    return mergeText(pieces);
  }
  const stat = GIT_STAT.exec(line);
  if (stat && isFilePath(stat[2]))
    return mergeText([{ text: stat[1] }, { text: stat[2], path: stat[2] }, { text: stat[3] }]);
  return mergeText(scanLine(line));
}

/**
 * 解析搜索结果的一行：行首的 路径[:行[:列]] 渲染为路径加行列号，其余原样保留。
 * [in] line：不含换行的一行。返回值：片段，拼接后与原文一致。
 */
export function parseSearchLine(line: string): OutputPiece[] {
  const match = SEARCH_LINE.exec(line);
  if (!match || !isFilePath(match[2])) return [{ text: line }];
  const [, lead, path, row, column, rest] = match;
  // 没有行号时整行必须只有路径，避免把“路径 说明文字”误当作结果行。
  if (row === undefined && rest.trim() !== "") return [{ text: line }];
  const location = row === undefined ? "" : `:${row}${column === undefined ? "" : `:${column}`}`;
  return mergeText([
    { text: lead },
    { text: path, path },
    { text: location, location: true },
    { text: rest },
  ]);
}

/**
 * 按行解析整段输出，换行符保留在文本片段中。
 * [in] text：输出正文；[in] mode：输出类型。返回值：片段，拼接后与 text 一致。
 */
export function parseOutput(text: string, mode: OutputMode): OutputPiece[] {
  const pieces: OutputPiece[] = [];
  for (const raw of splitLines(text)) {
    const body = raw.replace(/(?:\r\n|\r|\n)$/, "");
    pieces.push(...(mode === "search" ? parseSearchLine(body) : parseShellLine(body)));
    pieces.push({ text: raw.slice(body.length) });
  }
  return mergeText(pieces);
}

/** 提取需要确认存在性的候选路径，去重并限制数量。[in] pieces：解析结果。返回值：候选路径。 */
export function outputPaths(pieces: readonly OutputPiece[]): string[] {
  const paths = new Set<string>();
  for (const piece of pieces) {
    if (piece.path !== undefined) paths.add(piece.path);
    if (paths.size >= MAX_OUTPUT_CANDIDATES) break;
  }
  return [...paths];
}

const confirmed = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * 一次性确认一批路径，结果按 probe 缓存；确认失败视为不存在且不缓存，以便文件之后出现时重试。
 * [in] probe：存在性确认入口；[in] paths：候选路径。返回值：确实存在的路径集合。
 */
export async function confirmFiles(
  probe: (path: string) => Promise<boolean>,
  paths: readonly string[],
): Promise<ReadonlySet<string>> {
  let cache = confirmed.get(probe);
  if (!cache) confirmed.set(probe, (cache = new Map()));
  const unique = [...new Set(paths)].slice(0, MAX_OUTPUT_CANDIDATES);
  const results = await Promise.all(
    unique.map((path) => {
      let pending = cache.get(path);
      if (!pending) {
        pending = probe(path).catch(() => false);
        cache.set(path, pending);
        void pending.then((exists) => {
          if (!exists) cache.delete(path);
        });
      }
      return pending;
    }),
  );
  return new Set(unique.filter((_, index) => results[index]));
}

const NO_FILES: ReadonlySet<string> = new Set();

/** 确认候选路径是否存在；未确认或没有 probe 时返回空集合，调用方据此保持纯文本。[in] paths：候选路径。返回值：存在的路径集合。 */
export function useExistingFiles(paths: readonly string[]): ReadonlySet<string> {
  const probe = useContext(OutputFileProbe);
  const key = paths.join("\n");
  const [state, setState] = useState<{
    probe: unknown;
    key: string;
    found: ReadonlySet<string>;
  }>();
  useEffect(() => {
    if (!probe || !key) return;
    let active = true;
    void confirmFiles(probe, key.split("\n")).then((found) => {
      if (active) setState({ probe, key, found });
    });
    return () => {
      active = false;
    };
  }, [probe, key]);
  return state && state.probe === probe && state.key === key ? state.found : NO_FILES;
}
