import { toolOperation } from "../../shared/tool-presentation";
import { isErrorOnlyMessage } from "./transcript-model";
import type { ProcessItem, ToolEvidence } from "./transcript-types";

export type CardKind =
  | "readonly"
  | "edit"
  | "delete"
  | "write"
  | "bash"
  | "eval"
  | "wait"
  | "task"
  | "ask"
  | "search"
  | "process"
  | "message-out"
  | "message-in"
  | "agent-output"
  | "mcp"
  | "yield"
  | "invalid"
  | "generic";
export type CardStatus = "running" | "ok" | "error" | "cancelled" | "unknown";
export type VirtualScheme =
  | "local"
  | "agent"
  | "xd"
  | "proc"
  | "artifact"
  | "history"
  | "http"
  | "https"
  | "omp"
  | "cfg"
  | "ssh"
  | "attachment";
type ToolItem = Extract<ProcessItem, { kind: "tool" }>;
export type CardEntry =
  | ProcessItem
  | {
      kind: "errors";
      key: string;
      items: Extract<ProcessItem, { kind: "message" }>[];
    }
  | { kind: "readonly"; key: string; items: ToolItem[] };

/** 安全读取普通对象；不把数组或空值当字段集合。 */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 读取完整参数对象，流式残片保持无目标状态。 */
function argsObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** 获取工具结果的结构化详情，历史结果优先，不混入过期实时值。 */
export function toolDetails(tool: ToolEvidence): Record<string, unknown> {
  return (
    object((tool.resultMessage ?? object(tool.live?.result))?.details) ?? {}
  );
}

/** 提取原生结果文本，忽略图片；没有文本块时保留对象的可读 JSON。 */
export function toolResultText(tool: ToolEvidence): string {
  const result = tool.resultMessage ?? tool.live?.result;
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  const payload = object(result);
  if (typeof payload?.output === "string") return payload.output;
  if (typeof payload?.content === "string") return payload.content;
  if (Array.isArray(payload?.content)) {
    return payload.content
      .flatMap((part: unknown) => {
        const block = object(part);
        return block?.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [];
      })
      .join("\n");
  }
  try {
    return JSON.stringify(result, null, 2) ?? "";
  } catch {
    return "";
  }
}

/** 识别虚拟资源前缀，仅用于展示，不改变文件授权。 */
export function virtualScheme(path: string): VirtualScheme | undefined {
  const scheme = /^([a-z]+):\/\//i.exec(path)?.[1].toLowerCase();
  switch (scheme) {
    case "local":
    case "agent":
    case "xd":
    case "proc":
    case "artifact":
    case "history":
    case "http":
    case "https":
    case "omp":
    case "cfg":
    case "ssh":
    case "attachment":
      return scheme;
    default:
      return undefined;
  }
}

/** 按验证失败、危险操作、虚拟资源及普通工具的优先级选择卡片。 */
export function cardKind(tool: ToolEvidence): CardKind {
  const details = toolDetails(tool);
  const args = argsObject(tool.args);
  const op = toolOperation(tool.name);
  const leaf = tool.name
    .toLowerCase()
    .split(/__|[.:/]/)
    .at(-1);
  const path = args?.path ?? args?.file_path ?? args?.filePath;
  const scheme = typeof path === "string" ? virtualScheme(path) : undefined;
  if (
    details.isError === true &&
    typeof details.error === "string" &&
    details.error.startsWith("Validation failed")
  )
    return "invalid";
  if (op === "edit" && details.op === "delete") return "delete";
  if (op === "write" && scheme === "agent") return "message-out";
  if (op === "read" && scheme === "agent") return "agent-output";
  if (op === "write" && scheme === "xd") return "mcp";
  if ((op === "read" || op === "write") && scheme === "proc") return "process";
  if (leaf === "hub")
    return (args?.op ?? details.op) === "inbox" ? "message-in" : "process";
  if (
    op === "bash" &&
    details.service !== undefined &&
    details.service !== null
  )
    return "process";
  if (op === "read" || op === "grep" || op === "glob") return "readonly";
  if (op === "edit" || op === "write" || op === "bash" || op === "search")
    return op;
  if (
    leaf === "eval" ||
    leaf === "wait" ||
    leaf === "task" ||
    leaf === "ask" ||
    leaf === "yield"
  )
    return leaf;
  return "generic";
}

/** 读取卡片状态：历史终态优先，取消先于错误，未完成参数视为生成中。 */
export function cardStatus(tool: ToolEvidence): CardStatus {
  const result = tool.resultMessage ?? object(tool.live?.result);
  const details = toolDetails(tool);
  if (
    result?.cancelled === true ||
    details.cancelled === true ||
    result?.stopReason === "aborted" ||
    details.status === "cancelled"
  )
    return "cancelled";
  if (
    result?.isError === true ||
    result?.errorMessage ||
    result?.stopReason === "error" ||
    details.isError === true ||
    details.status === "error" ||
    (typeof details.exitCode === "number" && details.exitCode !== 0) ||
    (typeof result?.exitCode === "number" && result.exitCode !== 0) ||
    (!tool.resultMessage && tool.live?.error)
  )
    return "error";
  if (tool.resultMessage) return "ok";
  if (tool.live?.running || tool.streamingArgs !== undefined) return "running";
  return tool.live ? "ok" : "unknown";
}

/** 工具耗时按结果字段、隐藏开始记录、实时帧取值；无可信时间时返回 undefined。 */
export function toolDurationMs(
  tool: ToolEvidence,
  now: number,
): number | undefined {
  const details = toolDetails(tool);
  for (const value of [details.wallTimeMs, details.totalDurationMs]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      return value;
  }
  if (
    Number.isFinite(tool.startedAt) &&
    Number.isFinite(tool.resultMessage?.timestamp)
  ) {
    return Math.max(0, tool.resultMessage!.timestamp! - tool.startedAt!);
  }
  const live = tool.live;
  if (live && Number.isFinite(live.startedAt)) {
    if (Number.isFinite(live.endedAt))
      return Math.max(0, live.endedAt! - live.startedAt!);
    if (!tool.resultMessage && live.running && Number.isFinite(now))
      return Math.max(0, now - live.startedAt!);
  }
  return undefined;
}

/** 合并相邻只读工具与纯错误，普通工具、消息和思考保留原始边界；不修改输入。 */
export function groupCardItems(items: readonly ProcessItem[]): CardEntry[] {
  const entries: CardEntry[] = [];
  for (const item of items) {
    const last = entries.at(-1);
    if (item.kind === "message" && isErrorOnlyMessage(item.message)) {
      if (last?.kind === "errors") last.items.push(item);
      else entries.push({ kind: "errors", key: item.key, items: [item] });
    } else if (item.kind === "tool" && cardKind(item.tool) === "readonly") {
      if (last?.kind === "readonly") last.items.push(item);
      else entries.push({ kind: "readonly", key: item.key, items: [item] });
    } else entries.push(item);
  }
  return entries;
}

export type NativeDiffLine =
  | { kind: "context" | "add" | "del"; line?: number; text: string }
  | { kind: "gap"; hidden?: number };

/** 解析原生编辑差异；保留未知格式，并从相邻段行号计算未修改行数。 */
export function parseNativeDiff(diff: string): NativeDiffLine[] {
  if (!diff) return [];
  const lines: NativeDiffLine[] = diff
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text) => {
      if (!text) return { kind: "gap" };
      const match = /^([ +-])\s*(\d+)\|(.*)$/.exec(text);
      return match
        ? {
            kind:
              match[1] === "+" ? "add" : match[1] === "-" ? "del" : "context",
            line: Number(match[2]),
            text: match[3],
          }
        : { kind: "context", text };
    });
  for (let index = 0; index < lines.length; index++) {
    const gap = lines[index];
    if (gap.kind !== "gap") continue;
    const before = lines[index - 1];
    const after = lines[index + 1];
    if (
      before &&
      before.kind !== "gap" &&
      before.line !== undefined &&
      after &&
      after.kind !== "gap" &&
      after.line !== undefined
    ) {
      gap.hidden = after.line - before.line - 1;
    }
  }
  return lines;
}

/** 统计差异中的实际新增与删除行；上下文和间隔不计入修改。 */
export function diffStats(lines: readonly NativeDiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "del") removed++;
  }
  return { added, removed };
}

/** 返回输出末尾 n 行及总行数；末尾换行是终止符，空输出没有行。 */
export function outputTail(
  text: string,
  n: number,
): { lines: string[]; total: number } {
  if (!text) return { lines: [], total: 0 };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const total = lines.length;
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : total;
  return { lines: count ? lines.slice(-count) : [], total };
}
