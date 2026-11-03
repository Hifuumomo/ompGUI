import type { StreamingMessageContent } from "../../shared/streamed-message";

type StringToken = { value: string; end: number; closed: boolean };

const escapes: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
};

/** 扫描完整或截断的 JSON 字符串；未完成转义和末尾高代理项不进入预览。 */
function scanString(text: string, start: number): StringToken {
  let value = "";
  let index = start + 1;
  let closed = false;
  while (index < text.length) {
    const char = text[index++];
    if (char === '"') {
      closed = true;
      break;
    }
    if (char === "\\") {
      if (index === text.length) break;
      const escape = text[index++];
      if (escape === "u") {
        const hex = text.slice(index, index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else {
        if (escapes[escape] === undefined) break;
        value += escapes[escape];
      }
    } else {
      if (char.charCodeAt(0) < 0x20) break;
      value += char;
    }
  }
  const last = value.charCodeAt(value.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) value = value.slice(0, -1);
  return { value, end: index, closed };
}

type Container = {
  kind: "object" | "array";
  path: string;
  state: "key" | "colon" | "value" | "comma";
  key: string;
  index: number;
  capture: boolean;
};

/**
 * 从未完成 JSON 中扫描顶层和首个数组元素的字符串，只用于界面显示。
 * 不得用于授权、文件预览、工具证据或任何文件访问；截断输入不会抛错。
 */
export function previewStreamingArgs(
  text: string,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  let index = 0;
  while (/\s/.test(text[index] ?? "") && index < text.length) index += 1;
  if (text[index++] !== "{") return result;
  const stack: Container[] = [
    {
      kind: "object",
      path: "",
      state: "key",
      key: "",
      index: 0,
      capture: true,
    },
  ];
  while (index < text.length && stack.length > 0) {
    const parent = stack[stack.length - 1];
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      if ((char === "}") !== (parent.kind === "object")) break;
      stack.pop();
      index += 1;
      continue;
    }
    if (parent.state === "key") {
      if (char !== '"') break;
      const token = scanString(text, index);
      if (!token.closed) break;
      parent.key = token.value;
      parent.state = "colon";
      index = token.end;
      continue;
    }
    if (parent.state === "colon") {
      if (char !== ":") break;
      parent.state = "value";
      index += 1;
      continue;
    }
    if (parent.state === "comma") {
      if (char !== ",") break;
      parent.state = parent.kind === "object" ? "key" : "value";
      parent.index += 1;
      index += 1;
      continue;
    }
    const key = parent.kind === "object" ? parent.key : String(parent.index);
    const path = parent.path ? `${parent.path}.${key}` : key;
    parent.state = "comma";
    if (char === '"') {
      const token = scanString(text, index);
      if (
        parent.capture &&
        parent.kind === "object" &&
        !Object.hasOwn(result, path)
      ) {
        result[path] = token.value;
      }
      index = token.end;
      if (!token.closed) break;
    } else if (char === "{" || char === "[") {
      const capture =
        char === "{" &&
        parent.kind === "array" &&
        parent.index === 0 &&
        stack.length === 2;
      stack.push({
        kind: char === "{" ? "object" : "array",
        path,
        state: char === "{" ? "key" : "value",
        key: "",
        index: 0,
        capture,
      });
      index += 1;
    } else {
      const start = index;
      while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
      if (index === start) break;
    }
  }
  return result;
}

/** 原生 freeform 补丁仅投影为显示字段，不参与工具参数或文件授权。 */
function displayStreamingArgs(text: string): Readonly<Record<string, string>> {
  return text.startsWith("*** Begin Patch")
    ? { input: text }
    : previewStreamingArgs(text);
}

type PreviewCache = {
  text: string;
  latest: string;
  at: number;
  value: Readonly<Record<string, string>>;
  timer?: number | NodeJS.Timeout;
};
const previews = new Map<string, PreviewCache>();
const previewIntervalMs = 50;
const maxPreviewEntries = 128;
const listeners = new Set<() => void>();
let revision = 0;

/** 为转录订阅尾沿刷新；取消订阅不保留组件引用。 */
export function subscribeStreamingPreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 提供 useSyncExternalStore 所需的稳定版本快照。 */
export function streamingPreviewRevision(): number {
  return revision;
}

/** 完整调用不再读取预览时，显式释放其缓存并取消尚未交付的尾沿通知。 */
export function clearStreamingToolPreview(id: string | undefined): void {
  if (id === undefined) return;
  globalThis.clearTimeout(previews.get(id)?.timer);
  previews.delete(id);
}

/** 同一工具最多每 50ms 解析一次；尾沿刷新最新文本并通知转录。 */
export function streamingToolPreview(
  part: StreamingMessageContent,
): Readonly<Record<string, string>> | undefined {
  const key = part.id;
  const text = part.partialArguments;
  if (
    part.type !== "toolCall" ||
    part.arguments !== undefined ||
    typeof text !== "string"
  ) {
    clearStreamingToolPreview(key);
    return undefined;
  }
  // 无标识调用不能互相共用缓存，避免不同工具展示串流。
  if (key === undefined) return displayStreamingArgs(text);
  const now = Date.now();
  const previous = previews.get(key);
  if (previous) {
    previous.latest = text;
    if (previous.text === text) return previous.value;
    const remaining = previewIntervalMs - (now - previous.at);
    if (remaining > 0 && remaining <= previewIntervalMs) {
      previous.timer ??= globalThis.setTimeout(() => {
        previous.timer = undefined;
        if (previews.get(key) !== previous || previous.text === previous.latest)
          return;
        previous.text = previous.latest;
        previous.value = displayStreamingArgs(previous.latest);
        previous.at = Date.now();
        revision += 1;
        for (const listener of listeners) listener();
      }, remaining);
      return previous.value;
    }
    globalThis.clearTimeout(previous.timer);
  }
  const value = displayStreamingArgs(text);
  previews.delete(key);
  previews.set(key, { text, latest: text, at: now, value });
  if (previews.size > maxPreviewEntries) {
    const oldest = previews.keys().next().value;
    clearStreamingToolPreview(oldest);
  }
  return value;
}
