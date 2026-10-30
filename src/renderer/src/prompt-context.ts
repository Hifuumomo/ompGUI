import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";

/** 元数据与正文一起围栏隔离，引用中的 Markdown 不成为宿主指令。 */
export function formatPromptContext(context: PromptContext, comment?: string, imageNumber?: number): string {
  validatePromptContext(context);
  if (comment !== undefined && (!comment.trim() || comment.length > 16000)) throw new Error("评论不能为空，且不能超过 16000 字符");
  let source: string;
  let text: string;
  if (context.kind === "web") {
    source = `网页：${context.title}\nURL：${context.url}`;
    if (context.element) source += `\n网页元素：<${context.element.tag}> ${context.element.label}`;
    text = context.text;
  } else if (context.kind === "pdf") {
    source = `PDF：${context.title}\nURL：${context.url}\n页码：第${context.page}页\n选择类型：${({ paragraph: "段落", figure: "图块", region: "区域", text: "文本" })[context.selection]}`;
    text = context.text;
  } else if (context.kind === "web-region") {
    source = `网页区域截图：${context.title}\nURL：${context.url}`;
    text = "";
  } else if (context.kind === "file") {
    source = `文件：${context.path}`;
    if (context.startLine !== undefined) source += `\n源行：${context.startLine}–${context.endLine ?? context.startLine}`;
    if (context.representation === "preview") source += "\nMarkdown 可见预览（非源码行号）";
    if (context.representation === "reference") source += "\n文件引用（不包含文件内容）";
    text = context.text;
    if (context.representation === "source" && text && !text.endsWith("\n")) text += "\n（源码选区无末尾换行）";
  } else {
    source = `Git diff：${context.path}\n基线：${context.base ?? "空基线"}\n侧：${context.side}`;
    if (context.previousPath) source += `\n旧路径：${context.previousPath}`;
    text = context.rows.map(row => `旧:${row.oldLine ?? "-"} 新:${row.newLine ?? "-"} ${row.kind === "addition" ? "+" : row.kind === "deletion" ? "-" : " "}${row.text}${row.ending || "\n（该行无末尾换行）\n"}`).join("");
  }
  if ("image" in context && context.image) source += imageNumber === undefined ? "\n包含选区图片" : `\n附图：本条消息第${imageNumber}张图片`;
  const body = `${source}\n\n${text}`;
  let longest = 2;
  for (const match of body.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${body}${body.endsWith("\n") ? "" : "\n"}${fence}${comment === undefined ? "" : `\n\n评论：${comment}`}`;
}
