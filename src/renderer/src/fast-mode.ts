export type FastPhase = "off" | "on" | "degraded";

export const FAST_SHORTCUT = "Alt+F";

/** 以回显状态判定 Fast 阶段；旧版后端缺失 active 时不误报降级。 */
export function fastPhase(state?: {
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
}): FastPhase {
  if (state?.fastModeEnabled !== true) return "off";
  return state.fastModeActive === false ? "degraded" : "on";
}

/** 生成原生按钮提示；仅生效时附带有限正数速度，null 表示尚无测速。 */
export function fastTitle(phase: FastPhase, tokensPerSecond?: number | null): string {
  if (phase === "off") return `Fast 已关闭 · ${FAST_SHORTCUT} 开启`;
  if (phase === "degraded")
    return `Fast 已开启，但当前模型或服务商未生效 · ${FAST_SHORTCUT} 关闭`;
  const title = `Fast 已开启 · ${FAST_SHORTCUT} 关闭`;
  return typeof tokensPerSecond === "number" && Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
    ? `${title} · 最近 ${Math.round(tokensPerSecond)} tokens/s`
    : title;
}

/** 将原生服务档位转换为树行展示值；缺失值表示清除档位。 */
export function serviceTierLabel(tier: unknown): string {
  if (tier === "priority") return "Fast";
  if (tier === "ultrafast") return "Ultrafast";
  return typeof tier === "string" && tier !== "" ? tier : "标准";
}
