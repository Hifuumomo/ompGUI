import type { AgentMessage } from "../../shared/protocol";

export type PlanApprovalPresentation =
  | { kind: "approved"; path: string; markdown: string }
  | { kind: "raw"; text: string };

// 只接受已核实的 omp 18.12.2 控制信封；未知格式保留原文而不猜测正文。
const approvalEnvelope = new RegExp([
  '^Plan approved\\.\\n',
  '(?:- History usable; the plan below authoritative if it conflicts with earlier exploration\\.\\n)?',
  '(?:[ \\t]*\\n)*<instruction>\\n',
  'Full plan inlined below; durable copy at `([^\\n"`]+)` \\(identical content\\)\\.\\n',
  'Execute plan step-by-step with full tool access; MUST verify each step before next\\.\\n',
  'NEVER re-read `\\1` while the inline plan is intact; the path is for subagent handoff and recovery only\\.\\n',
  '(?:Before execution: initialize todo tracking with `todo`\\.\\n',
  'After each completed step: immediately update `todo`\\.\\n',
  'If `todo` fails: fix payload; retry before continuing\\.\\n)?',
  '</instruction>\\n(?:[ \\t]*\\n)*<plan path="\\1">\\n',
  '([\\s\\S]*)\\n</plan>\\n(?:[ \\t]*\\n)*<critical>\\n',
  'Inline plan compressed, expired, or unrecoverable: NEVER stop; read `\\1`\\.\\n',
  'Read failure: report exact path and error; NEVER guess\\.\\n',
  'MUST continue until complete\\.\\n</critical>$',
].join(''));

/** 将原生批准指令投影为只读展示；不修改消息或读取当前计划文件。 */
export function planApprovalPresentation(
  message: AgentMessage,
): PlanApprovalPresentation | undefined {
  if (message.role !== "developer" || message.synthetic !== true) return;
  const content = message.content;
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content) && content.every(
    (part) => part.type === "text" && typeof part.text === "string",
  )) text = content.map((part) => part.text).join("");
  else return;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!/^Plan approved\.(?:\n|$)/.test(normalized)) return;
  // 贪婪正文以末尾已校验的 critical 区块为边界，允许代码中包含 </plan>。
  const match = approvalEnvelope.exec(normalized);
  if (!match || !match[2].trim()) return { kind: "raw", text };
  return { kind: "approved", path: match[1], markdown: match[2] };
}
