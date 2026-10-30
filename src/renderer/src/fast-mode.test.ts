import { expect, it } from "vitest";
import { FAST_SHORTCUT, fastPhase, fastTitle, serviceTierLabel } from "./fast-mode";

it.each([
  [undefined, "off"],
  [{}, "off"],
  [{ fastModeEnabled: false }, "off"],
  [{ fastModeActive: true }, "off"],
  [{ fastModeEnabled: false, fastModeActive: false }, "off"],
  [{ fastModeEnabled: true }, "on"],
  [{ fastModeEnabled: true, fastModeActive: true }, "on"],
  [{ fastModeEnabled: true, fastModeActive: false }, "degraded"],
] as const)("Fast 状态 %j 对应 %s", (state, expected) => {
  expect(fastPhase(state)).toBe(expected);
});

it("固定使用无菜单冲突的 Alt+F 快捷键", () => {
  expect(FAST_SHORTCUT).toBe("Alt+F");
});

it.each([
  ["off", "Fast 已关闭 · Alt+F 开启"],
  ["on", "Fast 已开启 · Alt+F 关闭"],
  ["degraded", "Fast 已开启，但当前模型或服务商未生效 · Alt+F 关闭"],
] as const)("%s 的提示说明真实状态和快捷键", (phase, expected) => {
  expect(fastTitle(phase)).toBe(expected);
});

it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity])("无测速或无效速度 %s 不追加提示", (speed) => {
  expect(fastTitle("on", speed)).toBe("Fast 已开启 · Alt+F 关闭");
});

it.each([[83.6, 84], [83.4, 83], [0.4, 0]])("正数速度 %s 按四舍五入显示为 %s", (speed, rounded) => {
  expect(fastTitle("on", speed)).toBe(`Fast 已开启 · Alt+F 关闭 · 最近 ${rounded} tokens/s`);
});

it.each(["off", "degraded"] as const)("%s 即使有测速也不显示速度", (phase) => {
  expect(fastTitle(phase, 120)).toBe(fastTitle(phase));
});

it.each([
  ["priority", "Fast"],
  ["ultrafast", "Ultrafast"],
  [undefined, "标准"],
  [null, "标准"],
  ["", "标准"],
  ["flex", "flex"],
  ["custom-tier", "custom-tier"],
  [123, "标准"],
  [false, "标准"],
  [{}, "标准"],
] as const)("服务档位 %j 显示为 %s", (tier, expected) => {
  expect(serviceTierLabel(tier)).toBe(expected);
});
