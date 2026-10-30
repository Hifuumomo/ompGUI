import type { SessionEntry } from "../../shared/protocol";
import { serviceTierLabel } from "./fast-mode";

export interface TreeToolCall {
  readonly name: string;
  readonly arguments: unknown;
}

/** 读取文本块而不把工具参数混入回答。[in] value：原生内容。返回值：文本。 */
export function treeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join(" ");
}

/** 生成原生节点的一行内容。[in] entry：条目。返回值：角色与文本。 */
export function treeEntryText(
  entry: SessionEntry,
  tools?: ReadonlyMap<string, TreeToolCall>,
): string {
  const message = entry.message;
  const tool = message?.toolCallId ? tools?.get(message.toolCallId) : undefined;
  if (tool) return treeToolText(tool);
  if (message) return treeMessageText(message);
  const kind =
    entry.type === "custom_message"
      ? String(entry.customType)
      : entry.type.replaceAll("_", " ");
  const value = entryMetadataValue(entry);
  return `[${kind}]${value === undefined ? "" : `: ${String(value)}`}`.replace(
    /\s+/g,
    " ",
  );
}

/** 按原生条目类型读取对应展示字段。[in] entry：条目。返回值：展示值。 */
function entryMetadataValue(entry: SessionEntry): unknown {
  if (entry.type === "service_tier_change") {
    const tier = entry.serviceTier;
    // omp 18.13.1 实际按服务商族保存档位；旧会话的字符串与清除记录仍直接显示。
    return tier && typeof tier === "object" && !Array.isArray(tier)
      ? Object.entries(tier)
          .map(([provider, value]) => `${provider}: ${serviceTierLabel(value)}`)
          .join(" · ") || "标准"
      : serviceTierLabel(tier);
  }
  const fields: Record<string, unknown> = {
    model_change: entry.model,
    model_usage: `${entry.purpose ?? ""} ${entry.provider ?? ""}/${entry.model ?? ""}`,
    thinking_level_change: entry.thinkingLevel ?? "off",
    title_change: entry.title,
    mode_change: entry.mode,
    credential_pin: entry.provider,
    label: entry.label ?? "(cleared)",
    custom: entry.customType,
    branch_summary: entry.summary,
    compaction: `${entry.tokensBefore ?? 0} tokens`,
    custom_message: treeText(entry.content),
  };
  return fields[entry.type];
}

/** 从原生调用参数恢复工具行标题。[in] tool：原生调用。返回值：树行。 */
function treeToolText(tool: TreeToolCall): string {
  const args = tool.arguments as Record<string, unknown>;
  const value =
    args?.path ??
    args?.file_path ??
    args?.command ??
    args?.cmd ??
    args?.pattern ??
    args?.query;
  const detail =
    typeof value === "string"
      ? value.replace(/\s+/g, " ")
      : JSON.stringify(tool.arguments);
  return detail ? `[${tool.name}: ${detail}]` : `[${tool.name}]`;
}

/** 将消息显示为原生树行。[in] message：原生消息。返回值：单行预览。 */
function treeMessageText(
  message: NonNullable<SessionEntry["message"]>,
): string {
  if (message.role === "toolResult") return `[${message.toolName ?? "tool"}]`;
  if (message.role === "bashExecution")
    return `[bash]: ${message.command ?? ""}`;
  const text =
    treeText(message.content) ||
    message.errorMessage ||
    (message.stopReason === "aborted" ? "(aborted)" : "(no content)");
  return `${message.role}: ${text}`.replace(/\s+/g, " ");
}
