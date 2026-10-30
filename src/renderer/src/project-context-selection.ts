import type { ProjectDiffRow } from "../../shared/project-browser";

/** 以 UTF-16 offset 映射原文，结束端点位于下一行开头时不纳入该行。 */
export function sourceContextRange(content: string, start: number, end: number): {
  text: string; copyText: string; startLine: number; endLine: number;
} {
  if (!content || !Number.isInteger(start) || !Number.isInteger(end) || Math.min(start, end) < 0 || Math.max(start, end) > content.length) throw new Error("无有效源码选区");
  if (start > end) [start, end] = [end, start];
  // 一次扫描换行边界；CRLF 视为一个终结符，末尾 offset 不生成虚构空行。
  const firstPoint = Math.min(start, content.length - 1);
  const lastPoint = Math.min(Math.max(start, end - 1), content.length - 1);
  let first = 0;
  let last = content.length;
  let startLine = 1;
  let endLine = 1;
  let line = 1;
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== "\r" && content[index] !== "\n") continue;
    const boundary = index + (content[index] === "\r" && content[index + 1] === "\n" ? 2 : 1);
    if (boundary <= firstPoint) { first = boundary; startLine = line + 1; }
    if (lastPoint < boundary) { last = boundary; endLine = line; break; }
    line++;
    endLine = line;
    index = boundary - 1;
  }
  return { text: content.slice(first, last), copyText: content.slice(start, end), startLine, endLine };
}

const changedRow = (row: ProjectDiffRow) => row.kind === "addition" || row.kind === "deletion";

/** 提示词按连续变更块发送：端点是变更行时向外扩展到块边界，上下文行不扩展；不按侧过滤，保留原行对象引用。 */
export function diffChangeBlockRows(rows: readonly ProjectDiffRow[], startIndex: number, endIndex: number): readonly ProjectDiffRow[] {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || Math.min(startIndex, endIndex) < 0 || Math.max(startIndex, endIndex) >= rows.length) throw new Error("无有效差异选区");
  let first = Math.min(startIndex, endIndex);
  let last = Math.max(startIndex, endIndex);
  while (first > 0 && changedRow(rows[first]) && changedRow(rows[first - 1])) first--;
  while (last < rows.length - 1 && changedRow(rows[last]) && changedRow(rows[last + 1])) last++;
  return rows.slice(first, last + 1);
}

/** 索引始终是原始 diff 模型索引，重复文本不会混淆行身份。 */
export function diffContextRows(rows: readonly ProjectDiffRow[], startIndex: number, endIndex: number, side: "old" | "new" | "unified"): readonly ProjectDiffRow[] {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || Math.min(startIndex, endIndex) < 0 || Math.max(startIndex, endIndex) >= rows.length) throw new Error("无有效差异选区");
  return rows.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1).filter(row => side === "unified" || (side === "old" ? row.oldLine !== undefined : row.newLine !== undefined));
}
