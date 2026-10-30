import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";

export { COMMENT_PROMPT_PREAMBLE, stripCommentPreamble } from "../../shared/prompt-context";

/** 元数据用 JSON.stringify 单行生成，标题等字段中的换行和引号都被转义，无法伪造结构。 */
function contextMetadata(context: PromptContext, imageNumber?: number): string {
  const image = "image" in context && context.image ? (imageNumber === undefined ? { hasImage: true } : { image: imageNumber }) : {};
  let meta: Record<string, unknown>;
  if (context.kind === "web") {
    meta = { type: "web", title: context.title, url: context.url, element: context.element ? { tag: context.element.tag, label: context.element.label } : undefined };
  } else if (context.kind === "pdf") {
    meta = { type: "pdf", title: context.title, url: context.url, page: context.page, selection: context.selection, ...image };
  } else if (context.kind === "web-region") {
    meta = { type: "web-region", title: context.title, url: context.url, ...image };
  } else if (context.kind === "file") {
    const end = context.endLine ?? context.startLine;
    meta = {
      type: "file", path: context.path,
      lines: context.startLine === undefined ? undefined : end === context.startLine ? `${context.startLine}` : `${context.startLine}-${end}`,
      representation: context.representation === "source" ? undefined : context.representation,
    };
  } else {
    meta = { type: "diff", path: context.path, previousPath: context.previousPath || undefined, base: context.base };
  }
  return JSON.stringify(meta);
}

/** 元数据与正文一起围栏隔离，引用中的 Markdown 不成为宿主指令。 */
export function formatPromptContext(context: PromptContext, imageNumber?: number): string {
  validatePromptContext(context);
  let text: string;
  if (context.kind === "web" || context.kind === "web-region") {
    text = context.kind === "web" ? context.text : "";
  } else if (context.kind === "pdf") {
    text = context.text;
  } else if (context.kind === "file") {
    text = context.text;
    if (context.representation === "source" && text && !text.endsWith("\n")) text += "\n（源码选区无末尾换行）";
  } else {
    text = context.rows.map(row => `旧:${row.oldLine ?? "-"} 新:${row.newLine ?? "-"} ${row.kind === "addition" ? "+" : row.kind === "deletion" ? "-" : " "}${row.text}${row.ending || "\n（该行无末尾换行）\n"}`).join("");
  }
  const body = `${contextMetadata(context, imageNumber)}\n\n${text}`;
  let longest = 2;
  for (const match of body.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${body}${body.endsWith("\n") ? "" : "\n"}${fence}`;
}

/**
 * 展开为 <comment> 边界。标签后和代码块后的空行不可省：
 * 否则 Markdown 的 HTML 块会吞掉开头围栏。评论中的结束标签加反斜杠转义，其余内容原样保留。
 */
export function formatContextComment(number: number, context: PromptContext, comment: string, imageNumber?: number): string {
  if (!comment.trim() || comment.length > 16000) throw new Error("评论不能为空，且不能超过 16000 字符");
  const escaped = comment.replace(/<\/(?=comment)/gi, "<\\/");
  return `<comment id="${number}">\n\n${formatPromptContext(context, imageNumber)}\n\n${escaped}\n</comment>`;
}
