/** 工具详情的行数阈值，集中定义便于调参；截断只发生在渲染层，原始内容不变。 */

/** 文件详情默认预览的行数。 */
export const PREVIEW_LINES = 12;
/** 命令与工具输出过长时保留的首部行数。 */
export const OUTPUT_HEAD_LINES = 3;
/** 命令与工具输出过长时保留的尾部行数（测试、构建结论通常在末尾）。 */
export const OUTPUT_TAIL_LINES = 4;
/** 允许原地展开的最大行数，超过后只提供侧栏入口。 */
export const INLINE_EXPAND_LIMIT = 400;

/** 按行切分并保留各行终结符，终结换行不产生额外空行。[in] text：完整正文。返回值：带终结符的行数组。 */
export function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

/** 统计正文行数。[in] text：完整正文。返回值：行数，空文本为 0。 */
export function countLines(text: string): number {
  return splitLines(text).length;
}

/** 取前若干行原文。[in] text：完整正文；[in] count：行数。返回值：保留原始终结符的前缀。 */
export function headLines(text: string, count: number): string {
  return splitLines(text).slice(0, count).join("");
}

/** 把输出切成首、尾两段，中间省略。[in] text：完整正文。返回值：首段、尾段与被省略的行数；总行数不超过预览行数时不省略。 */
export function splitHeadTail(text: string): {
  head: string;
  tail: string;
  omitted: number;
} {
  const lines = splitLines(text);
  if (lines.length <= PREVIEW_LINES)
    return { head: text, tail: "", omitted: 0 };
  return {
    // 首段后面紧接省略按钮，去掉末行终结符避免多出空行。
    head: lines.slice(0, OUTPUT_HEAD_LINES).join("").replace(/\r\n$|[\r\n]$/, ""),
    tail: lines.slice(-OUTPUT_TAIL_LINES).join(""),
    omitted: lines.length - OUTPUT_HEAD_LINES - OUTPUT_TAIL_LINES,
  };
}
