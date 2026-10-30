import type { ReactNode } from "react";

export type FileFormat = "source" | "native" | "unified";
type RowKind = "context" | "addition" | "deletion" | "metadata";
export interface CodeRow {
  text: string;
  ending: string;
  kind: RowKind;
  line?: number | string;
  oldLine?: number | string;
  newLine?: number | string;
  tokens?: ReactNode[];
}
export interface SourceRowOptions {
  maxRows?: number;
  diff?: boolean;
  startLine?: number;
  lineNumbers?: ReadonlyArray<number | null>;
}
interface HunkState {
  oldLine: number;
  newLine: number;
  oldRemaining: number;
  newRemaining: number;
}

const MIN_GUTTER_DIGITS = 2;
const UNIFIED_GUTTER_PADDING = 18;
const SOURCE_GUTTER_PADDING = 10;

/** 获取源码输出行对应的真实行号，映射元行保持无编号。[in] index：零基输出行序号；[in] options：原生起始行和逐行映射。返回值：真实文件行号或无编号标识。 */
function sourceLine(index: number, options: SourceRowOptions) {
  return options.lineNumbers
    ? (options.lineNumbers[index] ?? undefined)
    : (options.startLine ?? 1) + index;
}

/** 只切出需要装饰的原始行，保留终结符且不补造尾行。[in] source：有界原文；[in] options：装饰行数、差异分行方式及真实源码行号。返回值：前缀行和原文已消费 UTF-16 位置。 */
export function sourceRows(source: string, options: SourceRowOptions = {}) {
  const rows: CodeRow[] = [];
  // 差异中的单独 CR 属于同一协议行正文，不能让 CR 后的 +/- 获得虚构增删身份。
  const pattern = options.diff
    ? /([^\n]*?)(\r?\n|$)/g
    : /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  let end = 0;
  while (
    rows.length < (options.maxRows ?? Infinity) &&
    (match = pattern.exec(source)) &&
    match[0] !== ""
  ) {
    rows.push({
      text: match[1],
      ending: match[2],
      kind: "context",
      line: sourceLine(rows.length, options),
    });
    end = pattern.lastIndex;
  }
  return { rows, end };
}

/** 统计完整源码的真实输出行数，终结换行不新增空行。[in] content：完整源码正文。返回值：实际显示的源码行数。 */
function sourceRowCount(content: string): number {
  let count = content ? 1 : 0;
  // CRLF 只算一次换行，结尾终结符不生成虚构尾行。
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\r" && content[index] !== "\n") continue;
    if (content[index] === "\r" && content[index + 1] === "\n") index += 1;
    if (index + 1 < content.length) count += 1;
  }
  return count;
}

/** 按全文的真实源码行号预留位宽，渐进装饰不改变正文起点。[in] content：完整源码；[in] options：真实起始行和逐行映射。返回值：行号轨道所需位数。 */
export function sourceDigits(content: string, options: SourceRowOptions) {
  const count = sourceRowCount(content);
  if (!options.lineNumbers)
    return Math.max(
      MIN_GUTTER_DIGITS,
      String((options.startLine ?? 1) + Math.max(0, count - 1)).length,
    );
  let digits = MIN_GUTTER_DIGITS;
  for (let index = 0; index < count; index += 1)
    digits = Math.max(digits, String(options.lineNumbers[index] ?? "").length);
  return digits;
}

/** 剥离原生单行号差异的真实标记，未知元信息保持中性。[in] row：原始差异行。返回值：保留真实十进制行号的原生差异行。 */
function nativeRow(row: CodeRow): CodeRow {
  const native = /^([ +\-])(\d+)\|/.exec(row.text);
  if (!native) return { ...row, line: undefined, kind: "metadata" };
  // 原生行号保留十进制原文，不经 Number 舍入改变 gutter 证据。
  const base = {
    ...row,
    text: row.text.slice(native[0].length),
    line: undefined,
  };
  if (native[1] === "+")
    return { ...base, kind: "addition", newLine: native[2] };
  if (native[1] === "-")
    return { ...base, kind: "deletion", oldLine: native[2] };
  return { ...base, kind: "context", line: native[2] };
}

/** 在 hunk 预算内识别有证据的增删或上下文行。[in] row：原始差异行；[in] state：当前 hunk 真实行号与剩余预算。返回值：解析后的行与新预算，无法识别时为空。 */
function markedRow(row: CodeRow, state: HunkState) {
  const base = { ...row, text: row.text.slice(1), line: undefined };
  if (row.text[0] === "+" && state.newRemaining > 0)
    return {
      row: { ...base, kind: "addition" as const, newLine: state.newLine },
      state: {
        ...state,
        newLine: state.newLine + 1,
        newRemaining: state.newRemaining - 1,
      },
    };
  if (row.text[0] === "-" && state.oldRemaining > 0)
    return {
      row: { ...base, kind: "deletion" as const, oldLine: state.oldLine },
      state: {
        ...state,
        oldLine: state.oldLine + 1,
        oldRemaining: state.oldRemaining - 1,
      },
    };
  if (row.text[0] === " " && state.oldRemaining > 0 && state.newRemaining > 0)
    return {
      row: {
        ...base,
        kind: "context" as const,
        oldLine: state.oldLine,
        newLine: state.newLine,
      },
      state: {
        oldLine: state.oldLine + 1,
        newLine: state.newLine + 1,
        oldRemaining: state.oldRemaining - 1,
        newRemaining: state.newRemaining - 1,
      },
    };
  return undefined;
}

/** 消费统一差异行，在未知内容处结束 hunk 而不编造增删身份。[in] row：原始差异行；[in] state：当前 hunk 状态。返回值：真实行结构和下一行使用的状态。 */
function unifiedRow(row: CodeRow, state: HunkState) {
  const metadata: CodeRow = { ...row, line: undefined, kind: "metadata" };
  if (state.oldRemaining > 0 || state.newRemaining > 0) {
    // 先消费 hunk 预算，正文中的 ---/+++ 仍然是代码而不是文件头。
    const marked = markedRow(row, state);
    if (marked) return marked;
    if (row.text === "\\ No newline at end of file")
      return { row: metadata, state };
  }
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row.text);
  const next = header
    ? {
        oldLine: Number(header[1]),
        newLine: Number(header[3]),
        oldRemaining: Number(header[2] ?? 1),
        newRemaining: Number(header[4] ?? 1),
      }
    : { ...state, oldRemaining: 0, newRemaining: 0 };
  return { row: metadata, state: next };
}

/** 剥离有证据的差异标记并记录真实行号。[in] content：有界真实差异；[in] format：原生单行号或统一差异格式。返回值：可审阅的差异行，源码起始行与映射均不参与。 */
export function diffRows(
  content: string,
  format: "native" | "unified",
): CodeRow[] {
  const { rows } = sourceRows(content, { diff: true });
  if (format === "native") return rows.map(nativeRow);
  let state: HunkState = {
    oldLine: 0,
    newLine: 0,
    oldRemaining: 0,
    newRemaining: 0,
  };
  const result: CodeRow[] = [];
  for (const row of rows) {
    const next = unifiedRow(row, state);
    result.push(next.row);
    state = next.state;
  }
  return result;
}

/** 为源码或真实差异生成 gutter 位宽和可见真实增删计数。[in] rows：已解析的代码行；[in] options：来源格式与源码全文位数。返回值：轨道宽度及可见增删计数。 */
export function rowMetrics(
  rows: CodeRow[],
  options: { format: FileFormat; sourceDigits?: number },
) {
  let digits = options.sourceDigits ?? MIN_GUTTER_DIGITS;
  if (options.format !== "source") {
    for (const row of rows)
      digits = Math.max(
        digits,
        String(row.line ?? "").length,
        String(row.oldLine ?? "").length,
        String(row.newLine ?? "").length,
      );
  }
  const unified = options.format === "unified";
  return {
    gutterWidth: `calc(${digits * (unified ? 2 : 1)}ch + ${unified ? UNIFIED_GUTTER_PADDING : SOURCE_GUTTER_PADDING}px)`,
    additions: rows.filter((row) => row.kind === "addition").length,
    deletions: rows.filter((row) => row.kind === "deletion").length,
  };
}
