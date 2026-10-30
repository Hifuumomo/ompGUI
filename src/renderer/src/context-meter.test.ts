import { expect, it } from "vitest";
import { contextLevel, formatTokenCount, isUsableContextUsage, meterWidth } from "./context-meter";

it.each([
  [999, "999"], [1000, "1K"], [2500, "2.5K"], [200000, "200K"],
  [272000, "272K"], [999949, "999.9K"], [999950, "1M"],
  [1048576, "1M"], [1500000, "1.5M"],
])("格式化窗口容量 %s 为 %s", (input, expected) => {
  expect(formatTokenCount(input)).toBe(expected);
});

it.each([
  [74.9, "normal"], [75, "high"], [89.9, "high"], [90, "critical"], [103, "critical"],
])("占用率 %s 对应 %s", (percent, expected) => {
  expect(contextLevel(percent)).toBe(expected);
});

it.each([[-5, 0], [0, 0], [50, 50], [130, 100]])("将 %s 的轨道宽度限制为 %s", (percent, expected) => {
  expect(meterWidth(percent)).toBe(expected);
});

it.each([
  undefined, null, {}, 72,
  { tokens: 1, contextWindow: 100 },
  { tokens: NaN, contextWindow: 100, percent: 1 },
  { tokens: Infinity, contextWindow: 100, percent: 1 },
  { tokens: 1, contextWindow: 100, percent: NaN },
  { tokens: 1, contextWindow: 100, percent: Infinity },
  { tokens: 1, contextWindow: 0, percent: 1 },
  { tokens: 1, contextWindow: -100, percent: 1 },
  { tokens: 1, contextWindow: Infinity, percent: 1 },
  { tokens: 1, contextWindow: NaN, percent: 1 },
  { tokens: "1", contextWindow: 100, percent: 1 },
])("拒绝不可用的上下文数据 %j", (usage) => {
  expect(isUsableContextUsage(usage)).toBe(false);
});

it.each([0, 72, 103])("接受真实占用率 %s，不把零或超限当成缺失", (percent) => {
  expect(isUsableContextUsage({ tokens: percent * 2000, contextWindow: 200000, percent })).toBe(true);
});
