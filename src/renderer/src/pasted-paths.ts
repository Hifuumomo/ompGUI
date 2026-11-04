/** 单次粘贴最多插入的路径数。 */
export const MAX_PASTED_PATHS = 200;

/** 含空白的路径加引号，其余原样返回。[in] path：本机绝对路径。返回值：可直接插入的路径文本。 */
export function quotePath(path: string): string {
  if (!/\s/.test(path)) return path;
  return path.includes('"') ? `'${path}'` : `"${path}"`;
}

/** 多个路径以空格连接并保持顺序。[in] paths：本机绝对路径。返回值：插入文本。 */
export function formatPastedPaths(paths: readonly string[]): string {
  return paths.map(quotePath).join(" ");
}

/** 在插入文本两侧补必要的空格，避免与已有文字粘连。[in] text：插入文本；[in] before：插入点前的草稿；[in] after：插入点后的草稿。返回值：补空格后的文本。 */
export function padInsertion(text: string, before: string, after: string): string {
  const head = before && !/\s$/.test(before) ? " " : "";
  const tail = after && !/^\s/.test(after) ? " " : "";
  return head + text + tail;
}

/**
 * 从粘贴数据中提取本机文件路径。
 * [in] data：剪贴板数据；[in] pathForFile：preload 暴露的取路径函数。
 * 返回值：路径列表；undefined 表示不干预，交给默认粘贴。
 */
export function pastedFilePaths(
  data: DataTransfer,
  pathForFile: (file: File) => string,
): string[] | undefined {
  // 同时带文本的来源（Office、IM 等）保持现有文本粘贴行为。
  if (data.types.includes("text/plain")) return undefined;
  const paths: string[] = [];
  for (const file of Array.from(data.files)) {
    const path = pathForFile(file);
    if (path) paths.push(path);
  }
  return paths.length ? paths : undefined;
}

/**
 * 在 textarea 光标处插入文本（替换选区），优先走浏览器编辑命令以保留撤销栈。
 * [in] element：目标输入框；[in] text：待插入文本（未补空格）；[in] sync：回退路径下同步受控草稿的回调。
 * 返回值：无。
 */
export function insertIntoTextarea(
  element: HTMLTextAreaElement,
  text: string,
  sync: (element: HTMLTextAreaElement) => void,
): void {
  const { selectionStart: start, selectionEnd: end, value } = element;
  const inserted = padInsertion(text, value.slice(0, start), value.slice(end));
  element.focus();
  // insertText 会触发 input → React onChange，并进入原生撤销栈。
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, inserted)) return;
  // 回退（jsdom 或命令被拒）：直接改值再同步草稿，此时 Ctrl+Z 无法撤销这次粘贴。
  element.setRangeText(inserted, start, end, "end");
  sync(element);
}
