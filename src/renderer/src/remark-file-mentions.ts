import { messageFileHref, messageFilePath } from "../../shared/message-file-link";
import { parseFileReferences } from "./file-reference-tokens";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

// 裸文件名采用常见文本/源码后缀，避免将 console.log、object.current 等表达式识别为文件。
const textFileName =
  /\.(?:txt|md|mdx|rst|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|html?|css|scss|less|[cm]?[jt]sx?|py|pyi|rb|rs|go|java|kt|c|cc|cpp|cxx|h|hh|hpp|cs|sh|bash|ps1|bat|sql|vue|svelte|tex)$/i;
const specialFileName =
  /^(?:\.env(?:\.[\w-]+)?|\.gitignore|\.gitattributes|\.editorconfig|Dockerfile|Makefile|README|LICENSE)$/i;

/**
 * 将独立的行内代码路径编码为文件链接；带目录和扩展名的文件不受文本后缀限制。
 * @param value [in] 行内代码原始文本，不作 URL 解码。
 * @returns 可用文件地址，或不满足路径规则时的 undefined。
 */
function fileMentionHref(value: string): string | undefined {
  if (!value || value !== value.trim() || /[\r\n<>|?*=";{}]/.test(value))
    return undefined;
  const path = value.replace(/\\/g, "/");
  // 新增目录识别仅接受 Windows 盘符加反斜杠，避免把命令、接口或表达式当路径。
  const windowsAbsolute = /^[a-z]:\\/i.test(value);
  if (windowsAbsolute && /[:\u0000-\u001f\u007f]/.test(value.slice(2)))
    return undefined;
  const explicitPath = /^(?:[a-z]:\/|\.{0,2}\/)/i.test(path);
  if (!explicitPath && /\s/.test(path)) return undefined;
  const name = path.split("/").pop()!;
  // 明确的文件路径也可能指向安装包、压缩包或图片；是否可预览由文件侧栏判断。
  const filePath = /\/[^/]+\.[a-z\d][a-z\d_-]*$/i.test(path);
  if (
    !windowsAbsolute &&
    !filePath &&
    !textFileName.test(name) &&
    !specialFileName.test(name)
  )
    return undefined;
  const href = messageFileHref(path);
  return messageFilePath(href) === undefined ? undefined : href;
}

/**
 * 将显式 @引用和既有行内代码文件路径转换为 Markdown 链接。
 * 参数：无。
 * @returns 原地更新语法树的 transformer，保留邮箱、现有链接、公式和代码块。
 */
export function remarkFileMentions() {
  /**
   * 遍历非链接内容，只在文本叶节点解析完整 @引用。
   * @param node [in,out] 当前 Markdown 节点及其待更新的子节点。
   * @returns 返回值：无。
   */
  function visit(node: MarkdownNode): void {
    if (!node.children || node.type === "link" || node.type === "linkReference")
      return;
    const children: MarkdownNode[] = [];
    for (const child of node.children) {
      if (child.type === "inlineCode") {
        const href = fileMentionHref(child.value ?? "");
        if (href) {
          children.push({ type: "link", url: href, children: [child] });
          continue;
        }
      } else if (child.type === "text") {
        const value = child.value ?? "";
        const references = parseFileReferences(value);
        if (references.length) {
          let offset = 0;
          for (const reference of references) {
            if (reference.start > offset)
              children.push({ type: "text", value: value.slice(offset, reference.start) });
            const href = messageFileHref(reference.path);
            const label = value.slice(reference.start, reference.end);
            children.push(messageFilePath(href) === undefined ? { type: "text", value: label } : {
              type: "link",
              url: href,
              children: [{ type: "text", value: label }],
            });
            offset = reference.end;
          }
          if (offset < value.length)
            children.push({ type: "text", value: value.slice(offset) });
          continue;
        }
      }
      visit(child);
      children.push(child);
    }
    node.children = children;
  }
  return visit;
}
