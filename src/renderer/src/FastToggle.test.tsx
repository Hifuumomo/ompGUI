import { expect, it, vi } from "vitest";
import { FastToggle } from "./FastToggle";
import { click, container, render } from "./transcript-test-harness";

it.each([
  [undefined, "off", "false", "Fast 已关闭 · Alt+F 开启"],
  [{}, "off", "false", "Fast 已关闭 · Alt+F 开启"],
  [{ fastModeEnabled: true }, "on", "true", "Fast 已开启 · Alt+F 关闭"],
  [{ fastModeEnabled: true, fastModeActive: true, tokensPerSecond: 85.6 }, "on", "true", "Fast 已开启 · Alt+F 关闭 · 最近 86 tokens/s"],
  [{ fastModeEnabled: true, fastModeActive: false, tokensPerSecond: 85.6 }, "degraded", "true", "Fast 已开启，但当前模型或服务商未生效 · Alt+F 关闭"],
] as const)("状态 %j 只显示闪电并提供可访问状态", async (state, phase, pressed, title) => {
  await render(<FastToggle state={state} disabled={false} pending={false} onToggle={() => {}} />);
  const button = container.querySelector("button")!;
  expect(button.type).toBe("button");
  expect(button.className).toBe("fast-toggle");
  expect(button.dataset.phase).toBe(phase);
  expect(button.getAttribute("aria-label")).toBe("Fast 模式");
  expect(button.getAttribute("aria-pressed")).toBe(pressed);
  expect(button.hasAttribute("aria-busy")).toBe(false);
  expect(button.title).toBe(title);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe("");
  expect(button.childNodes).toHaveLength(1);
  const svg = button.firstElementChild!;
  expect(svg.tagName.toLowerCase()).toBe("svg");
  expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.children).toHaveLength(1);
  expect(svg.firstElementChild?.tagName.toLowerCase()).toBe("path");
  expect(svg.firstElementChild?.getAttribute("d")).toBe("M6.2 0 L1 5.8 H4.4 L3.6 10 L9 3.9 H5.6 Z");
});

it.each([
  { fastModeEnabled: false },
  { fastModeEnabled: true, fastModeActive: true },
  { fastModeEnabled: true, fastModeActive: false },
])("等待期间保持原阶段、按下状态和提示 %j", async (state) => {
  const onToggle = vi.fn();
  await render(<FastToggle state={state} disabled={false} pending={false} onToggle={onToggle} />);
  const button = container.querySelector("button")!;
  const phase = button.dataset.phase;
  const pressed = button.getAttribute("aria-pressed");
  const title = button.title;
  await render(<FastToggle state={state} disabled={false} pending onToggle={onToggle} />);
  expect(button.dataset.phase).toBe(phase);
  expect(button.getAttribute("aria-pressed")).toBe(pressed);
  expect(button.title).toBe(title);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await click(button);
  expect(onToggle).not.toHaveBeenCalled();
  await render(<FastToggle state={state} disabled={false} pending={false} onToggle={onToggle} />);
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute("aria-busy")).toBe(false);
  await click(button);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it.each([[true, false], [false, true], [true, true]] as const)("disabled=%s pending=%s 时不触发切换", async (disabled, pending) => {
  const onToggle = vi.fn();
  await render(<FastToggle state={{ fastModeEnabled: true }} disabled={disabled} pending={pending} onToggle={onToggle} />);
  const button = container.querySelector("button")!;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe(pending ? "true" : null);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.title).toBe("Fast 已开启 · Alt+F 关闭");
  await click(button);
  expect(onToggle).not.toHaveBeenCalled();
});

it("随回显更新阶段，测速清空时移除旧速度", async () => {
  const onToggle = vi.fn();
  await render(<FastToggle state={{ fastModeEnabled: true, tokensPerSecond: 80 }} disabled={false} pending={false} onToggle={onToggle} />);
  const button = container.querySelector("button")!;
  expect(button.title).toContain("80 tokens/s");
  await render(<FastToggle state={{ fastModeEnabled: true, tokensPerSecond: null }} disabled={false} pending={false} onToggle={onToggle} />);
  expect(button.title).toBe("Fast 已开启 · Alt+F 关闭");
  await click(button);
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(button.dataset.phase).toBe("on");
  await render(<FastToggle state={{ fastModeEnabled: false }} disabled={false} pending={false} onToggle={onToggle} />);
  expect(button.dataset.phase).toBe("off");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(button.title).toBe("Fast 已关闭 · Alt+F 开启");
});
