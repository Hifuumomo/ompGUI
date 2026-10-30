import type { AgentMessage } from "../../shared/protocol";
import type { PlanStatusRecord } from "../../shared/plan-status";

const kinds = new Set(["approved", "executedElsewhere", "continued", "refined", "saved", "stopped", "compactCancelled", "failed"]);
const choices = new Set(["compact", "keep", "execute", "refine", "save"]);

/** 只接受已知版本的留档元数据，损坏或未知记录不参与渲染。 */
export function parsePlanStatus(message: AgentMessage): PlanStatusRecord | undefined {
  if (message.role !== "custom" || message.customType !== "ompgui-plan-status" || message.display === false) return;
  const value = message.details;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.operationId !== "string" || !record.operationId.trim() || typeof record.kind !== "string" || !kinds.has(record.kind) || typeof record.choice !== "string" || !choices.has(record.choice) || typeof record.planPath !== "string" || !record.planPath.startsWith("local://") || record.planPath.length <= 8) return;
  if (record.revision !== undefined && (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 1)) return;
  if (record.contextPercent !== undefined && (typeof record.contextPercent !== "number" || !Number.isFinite(record.contextPercent) || record.contextPercent < 0)) return;
  for (const field of ["savedPath", "sourceSessionFile", "targetSessionId", "document", "error"]) {
    if (record[field] !== undefined && typeof record[field] !== "string") return;
  }
  if (record.model !== undefined) {
    if (!record.model || typeof record.model !== "object" || Array.isArray(record.model)) return;
    const model = record.model as Record<string, unknown>;
    if (typeof model.provider !== "string" || !model.provider || typeof model.modelId !== "string" || !model.modelId) return;
    if (model.name !== undefined && typeof model.name !== "string") return;
    if (model.thinkingLevel !== undefined && typeof model.thinkingLevel !== "string") return;
  }
  return record as unknown as PlanStatusRecord;
}
