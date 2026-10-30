import type { ReadDisplayContent } from "./NativeReadContent";
import type { MessageContent } from "../../shared/protocol";

/** read 的模型文本使用 LINE:TEXT、LINE|TEXT 或 raw；null 是不带编号的省略行。 */
function numberedText(display: ReadDisplayContent, separator: string) {
  return display.text
    .split("\n")
    .map((text, index) => {
      const line = display.lineNumbers
        ? display.lineNumbers[index]
        : display.startLine + index;
      return line === null ? text : `${line}${separator}${text}`;
    })
    .join("\n");
}

/** 从已保存的真实正文重建编号段，只分离原生附加提示，不对源码做数字正则替换。 */
export function readNotices(
  original: string | MessageContent[] | undefined,
  display: ReadDisplayContent,
) {
  const text =
    typeof original === "string"
      ? original
      : (original ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  const header = /^\[[^\r\n]+#[0-9a-f]{4}\]\r?\n/im.exec(text)?.[0] ?? "";
  if (display.text === "")
    return { matched: true, text: text.replace(header, "") };
  const colon = numberedText(display, ":");
  const pipe = numberedText(display, "|");
  const candidates = [`${header}${colon}`, pipe];
  // 末尾 LF 是终结符；原生 hashline 不把它当成一个可寻址的额外空行。
  if (display.text.endsWith("\n"))
    candidates.push(`${header}${colon.slice(0, colon.lastIndexOf("\n"))}`);
  candidates.push(display.text);
  const body = candidates.find(
    (candidate) =>
      text.startsWith(candidate) || text.includes(`\n${candidate}`),
  );
  if (body === undefined) return { matched: false, text };
  const start = text.indexOf(body);
  return {
    matched: true,
    text: text.slice(0, start) + text.slice(start + body.length),
  };
}
