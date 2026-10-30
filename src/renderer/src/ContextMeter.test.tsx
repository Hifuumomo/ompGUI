import { expect, it } from "vitest";
import { ContextMeter } from "./ContextMeter";
import { container, render } from "./transcript-test-harness";

it("缺失或无效数据不渲染轨道，数据消失后移除旧占用", async () => {
  await render(<ContextMeter />);
  expect(container.childNodes).toHaveLength(0);
  await render(<ContextMeter usage={{ tokens: 144213, contextWindow: 200000, percent: 72 }} />);
  expect(container.querySelector('[role="meter"]')).not.toBeNull();
  await render(<ContextMeter usage={{ tokens: 0, contextWindow: 0, percent: 0 }} />);
  expect(container.childNodes).toHaveLength(0);
  await render(<ContextMeter />);
  expect(container.childNodes).toHaveLength(0);
});

it.each([
  [72, "normal", ["72%", "200K"]],
  [82, "high", ["82%", "200K"]],
  [84.9, "high", ["85%", "200K"]],
  [85, "high", ["85% / 200K"]],
  [94, "critical", ["94% / 200K"]],
])("%s%% 显示对应占用等级和标签", async (percent, level, labels) => {
  await render(<ContextMeter usage={{ tokens: percent * 2000, contextWindow: 200000, percent }} />);
  expect(container.querySelector(".context-meter")?.getAttribute("data-level")).toBe(level);
  expect([...container.querySelectorAll(".context-meter-label")].map((label) => label.textContent)).toEqual(labels);
});

it("辅助技术读取精确用量，提示显示总量与剩余量", async () => {
  await render(<ContextMeter usage={{ tokens: 144213, contextWindow: 200000, percent: 72.1065 }} />);
  const meter = container.querySelector('[role="meter"]')!;
  expect(meter.getAttribute("aria-label")).toBe("上下文占用");
  expect(meter.getAttribute("tabindex")).toBe("0");
  expect(meter.getAttribute("aria-valuemin")).toBe("0");
  expect(meter.getAttribute("aria-valuemax")).toBe("100");
  expect(meter.getAttribute("aria-valuenow")).toBe("72.1");
  expect(meter.getAttribute("aria-valuetext")).toBe(`上下文 72.1%，${(144213).toLocaleString()} / ${(200000).toLocaleString()} tokens`);
  const tooltip = container.querySelector(".context-meter-tooltip")!;
  expect(tooltip.textContent).toContain(`上下文 72.1%`);
  expect(tooltip.textContent).toContain(`${(144213).toLocaleString()} / ${(200000).toLocaleString()} tokens`);
  expect(tooltip.textContent).toContain(`剩余 ${(55787).toLocaleString()} tokens`);
});

it("超限时轨道满宽但标签保留真实值，剩余量不为负数", async () => {
  await render(<ContextMeter usage={{ tokens: 206000, contextWindow: 200000, percent: 103 }} />);
  expect(container.querySelector<HTMLElement>(".context-meter")?.style.getPropertyValue("--context-percent")).toBe("100");
  expect(container.querySelector(".context-meter-end")?.textContent).toBe("103% / 200K");
  expect(container.querySelector(".context-meter-tooltip")?.textContent).toContain("剩余 0 tokens");
});
