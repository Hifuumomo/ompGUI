import type { ModelSelection, ModelState } from "../../shared/protocol";
import type {
  NativeModelAction,
  NativeModelSnapshot,
} from "../../shared/native-model";

interface SelectionChange {
  readonly action: NativeModelAction;
  readonly snapshot: NativeModelSnapshot;
  readonly previous: ModelState | undefined;
  readonly current: ModelState;
  readonly connected: boolean;
}

/** 只有主会话模型操作会成为下一次恢复时的显式选择；离线任务选择单独传递。 */
export function modelHubSelection(change: SelectionChange): {
  session?: ModelSelection;
  task?: string;
} {
  const { action, current, previous, snapshot } = change;
  if ("target" in action && action.target === "task") {
    if (change.connected) return {};
    const selector =
      action.op === "temporary"
        ? action.selector
        : snapshot.roles.find((role) => role.role === action.role)
            ?.resolvedSelector;
    if (!selector) throw new Error("原生任务角色没有解析为可用模型。");
    return { task: selector };
  }
  const changed =
    current.model?.id !== previous?.model?.id ||
    current.model?.provider !== previous?.model?.provider ||
    current.thinkingLevel !== previous?.thinkingLevel;
  const explicit = action.op === "temporary" || action.op === "applyRole";
  const defaultChange =
    (action.op === "assign" || action.op === "clear") &&
    action.role === "default";
  if (
    !current.model ||
    !(explicit || (changed && (defaultChange || action.op === "switchPreset")))
  )
    return {};
  return {
    session: {
      provider: current.model.provider,
      modelId: current.model.id,
      thinkingLevel: current.thinkingLevel,
    },
  };
}
