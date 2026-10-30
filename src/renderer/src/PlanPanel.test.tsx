import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";
import { container, render } from "./transcript-test-harness";
import type { NativeModelSnapshot } from "../../shared/native-model";
import type { PlanController } from "./usePlan";

vi.mock("./PlanEditor", () => ({ PlanEditor: () => <div role="textbox" aria-label="计划正文"><h1>计划概览</h1><h2>实施步骤</h2><h4>验证边界</h4></div> }));
const storageKeys = ["omp-desktop.plan-choice", "omp-desktop.plan-toc-collapsed", "omp-desktop.plan-toc-width"];
beforeEach(() => { storageKeys.forEach((key) => localStorage.removeItem(key)); });
afterEach(() => { vi.unstubAllGlobals(); storageKeys.forEach((key) => localStorage.removeItem(key)); });
const catalog: NativeModelSnapshot = {
  models: [
    { selector: "one/small", provider: "one", id: "small", name: "Small", kind: "chat", contextWindow: 1000, reasoning: true, thinkingLevels: ["inherit", "low"], allowedRoles: [] },
    { selector: "two/large", provider: "two", id: "large", name: "Large", kind: "chat", contextWindow: 10000, reasoning: true, thinkingLevels: ["inherit", "high"], allowedRoles: [] },
  ], roles: [], providers: [{ id: "one", locked: false, oauth: false, count: 1 }, { id: "two", locked: false, oauth: false, count: 1 }], recent: [], cycleOrder: ["one/small"], fallbackChains: {}, presets: { names: [] }, storage: "global", currentSelector: "one/small", query: "", matches: [],
};
function plan(tokens: number): PlanController {
  return {
    snapshot: { identity: { sessionId: "session", sessionFile: "session.jsonl", epoch: "epoch" }, phase: "review", busy: false, reviewId: "review", document: { path: "local://test-plan.md", title: "Test", content: "# Test", revision: "hash", saveFileName: "test.md" }, context: { tokens, contextWindow: 1000, percent: tokens / 10 } },
    value: "# Test", visible: true, dirty: false, saving: false, error: "", conflict: undefined, editor: { current: null }, reloadNonce: 0, connected: true,
    onDirty() {}, onChange() {}, status: vi.fn(), act: vi.fn(), decide: vi.fn(async () => undefined), flush: vi.fn(), protect: vi.fn(), hide() {}, show() {}, reload() {},
  };
}
async function mount(controller = plan(500), onRefine = vi.fn()) {
  await render(<PlanPanel plan={controller} catalog={catalog} onCatalog={async () => {}} onRefine={onRefine} onError={(cause) => { throw cause; }} />);
  return { controller, onRefine };
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
function trigger(label: string) { return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; }
function primary() { return container.querySelector<HTMLButtonElement>(".plan-primary-action")!; }
function menuChoice(label: string) { return [...container.querySelectorAll<HTMLButtonElement>(".plan-choice-menu button")].find((button) => button.textContent?.includes(label))!; }
async function openChoices() { await click(trigger("选择计划处置方式")); }

it("保留上下文的95%边界随所选模型窗口重算，非cycle模型可选", async () => {
  await mount(plan(960));
  await openChoices();
  expect(menuChoice("批准并保留上下文").disabled).toBe(true);
  await click(trigger("选择执行模型"));
  const large = [...container.querySelectorAll<HTMLButtonElement>('.plan-model-picker [role="radio"]')].find((button) => button.textContent?.includes("Large"))!;
  await click(large);
  expect(container.querySelector(".plan-model-picker")).not.toBeNull();
  expect(large.getAttribute("aria-checked")).toBe("true");
  await click(trigger("选择执行模型"));
  await openChoices();
  expect(menuChoice("批准并保留上下文").disabled).toBe(false);
  expect(container.querySelector(".plan-context")?.textContent).toContain("9.6%");
  const title = container.querySelector<HTMLElement>(".plan-context[title], .plan-context [title]")!.title.replace(/[,\s]/g, "");
  expect(title).toContain("960");
  expect(title).toContain("10000");
  expect(catalog.cycleOrder).toEqual(["one/small"]);
});
it("恰好95%允许保留上下文", async () => {
  await mount(plan(950));
  await openChoices();
  expect(menuChoice("批准并保留上下文").disabled).toBe(false);
  expect(container.querySelector(".plan-context")?.textContent).toContain("95.0%");
});
it("默认执行压缩，从菜单执行保留上下文并记住选择", async () => {
  await mount();
  expect(primary().textContent).toContain("批准并压缩执行");
  await click(primary());
  await openChoices();
  await click(menuChoice("批准并保留上下文"));
  expect(localStorage.getItem("omp-desktop.plan-choice")).toBe("keep");
  expect(primary().textContent).toContain("批准并保留上下文");
  expect(container.querySelector(".plan-choice-menu")).toBeNull();
  await click(primary());
});
it("记住的保留上下文超限时回退压缩，不覆盖记住的选择", async () => {
  localStorage.setItem("omp-desktop.plan-choice", "keep");
  await mount(plan(960));
  expect(primary().textContent).toContain("批准并压缩执行");
  await click(primary());
  expect(localStorage.getItem("omp-desktop.plan-choice")).toBe("keep");
});
it.each([
  ["选择计划处置方式", ".plan-choice-menu"],
  ["选择执行模型", ".plan-model-picker"],
])("%s浮层按Esc或点击外部关闭并恢复键盘焦点", async (label, selector) => {
  await mount();
  const button = trigger(label);
  await click(button);
  const popover = container.querySelector<HTMLDivElement>(selector)!;
  expect(popover).not.toBeNull();
  await act(async () => popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(container.querySelector(selector)).toBeNull();
  expect(document.activeElement).toBe(button);
  await click(button);
  expect(container.querySelector(selector)).not.toBeNull();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(container.querySelector(selector)).toBeNull();
});
it("applying时处置栏只剩停止按钮，停止请求沿用abort", async () => {
  const controller = plan(500);
  controller.snapshot = { ...controller.snapshot!, phase: "applying", busy: true };
  const request = vi.fn(async () => ({}));
  vi.stubGlobal("desktop", { request });
  await mount(controller);
  const bar = container.querySelector(".plan-bar")!;
  const buttons = bar.querySelectorAll<HTMLButtonElement>("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toContain("停止");
  expect(bar.textContent).toContain("正在执行计划");
  expect(bar.querySelector(".plan-primary-action, .plan-model-picker, textarea")).toBeNull();
  await click(buttons[0]);
  expect(request).toHaveBeenCalledWith({ type: "abort" });
});
it("目录导轨和头部下拉都滚动到对应标题，选择后关闭下拉", async () => {
  await mount();
  const heading = container.querySelector<HTMLElement>(".plan-document h2")!;
  const scrollIntoView = vi.fn();
  heading.scrollIntoView = scrollIntoView;
  const railItem = [...container.querySelectorAll<HTMLButtonElement>(".plan-toc-rail .plan-toc-list button")].find((button) => button.textContent === "实施步骤")!;
  await click(railItem);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  await click(container.querySelector<HTMLButtonElement>(".plan-toc-trigger")!);
  const dropdownItem = [...container.querySelectorAll<HTMLButtonElement>(".plan-toc-menu button")].find((button) => button.textContent === "实施步骤")!;
  await click(dropdownItem);
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".plan-toc-menu")).toBeNull();
});
it("继续完善仅通知主输入框，不直接批准或发送完善意见", async () => {
  const { controller, onRefine } = await mount();
  const button = [...container.querySelectorAll<HTMLButtonElement>(".plan-bar button")].find((item) => item.textContent?.includes("继续完善"))!;
  await click(button);
  expect(onRefine).toHaveBeenCalledOnce();
  expect(controller.decide).not.toHaveBeenCalled();
  expect(container.querySelector(".plan-bar textarea")).toBeNull();
});
