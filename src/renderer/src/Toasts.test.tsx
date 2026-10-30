import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToastController, ToastNotice } from "./Toasts";
import { Toasts, useToasts } from "./Toasts";
import { click, container, render } from "./transcript-test-harness";

let controller: ToastController;

function Harness({ session = "a" }: { session?: string }) {
  controller = useToasts();
  return <><span>{session}</span><Toasts items={controller.items} dismiss={controller.dismiss} /></>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

async function push(...notices: ToastNotice[]) {
  await act(() => { for (const notice of notices) controller.push(notice); });
}

async function advance(milliseconds: number) {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds));
}

function cards() {
  return [...container.querySelectorAll<HTMLElement>(".toast")];
}

async function hover(node: Element, entering: boolean) {
  await act(() => node.dispatchEvent(new MouseEvent(entering ? "mouseover" : "mouseout", {
    bubbles: true,
    relatedTarget: document.body,
  })));
}

it("信息和成功通知各显示四秒，容器礼貌播报，详情原样显示", async () => {
  await render(<Harness />);
  expect(container.querySelector(".toasts")?.getAttribute("aria-live")).toBe("polite");
  await push({ level: "success", title: "计划已批准", detail: "使用模型执行" });
  expect(cards()[0].classList.contains("toast-success")).toBe(true);
  expect(cards()[0].textContent).toContain("使用模型执行");
  await advance(1000);
  await push({ level: "info", title: "继续完善计划" });
  await advance(2999);
  expect(cards()).toHaveLength(2);
  await advance(1);
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("继续完善计划");
  await advance(1000);
  expect(cards()).toHaveLength(0);
});

it("悬停只暂停当前通知，并多次按剩余时长恢复而非重新计四秒", async () => {
  await render(<Harness />);
  await push({ level: "success", title: "暂停的通知" }, { level: "info", title: "正常到期的通知" });
  const paused = cards()[0];
  await advance(1500);
  await hover(paused, true);
  await advance(10000);
  expect(cards()).toEqual([paused]);
  await hover(paused, false);
  await advance(1000);
  await hover(paused, true);
  await advance(10000);
  expect(cards()).toEqual([paused]);
  await hover(paused, false);
  await advance(1499);
  expect(cards()).toEqual([paused]);
  await advance(1);
  expect(cards()).toHaveLength(0);
});

it("警告与错误不自动消失，关闭按钮不提交所在表单", async () => {
  const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  await render(<form onSubmit={submit}><Harness /></form>);
  await push({ level: "warning", title: "已停止处置" }, { level: "error", title: "保存失败" });
  await advance(60000);
  expect(cards()).toHaveLength(2);
  expect(cards()[0].classList.contains("toast-warning")).toBe(true);
  expect(cards()[1].classList.contains("toast-error")).toBe(true);
  await click(cards()[0].querySelector<HTMLButtonElement>('[aria-label="关闭通知"]')!);
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("保存失败");
  await click(cards()[0].querySelector<HTMLButtonElement>('[aria-label="关闭通知"]')!);
  expect(cards()).toHaveLength(0);
  expect(submit).not.toHaveBeenCalled();
});

it("最多保留三条，逐出最旧通知，新通知排在底部且切换会话保留", async () => {
  await render(<Harness />);
  await push(
    { level: "info", title: "第一条" },
    { level: "warning", title: "第二条" },
    { level: "error", title: "第三条" },
    { level: "success", title: "第四条" },
  );
  expect(controller.items.map((item) => item.title)).toEqual(["第二条", "第三条", "第四条"]);
  expect(cards().map((card) => card.querySelector(".toast-title")?.textContent)).toEqual(["第二条", "第三条", "第四条"]);
  expect(new Set(controller.items.map((item) => item.id)).size).toBe(3);
  await render(<Harness session="b" />);
  expect(cards()).toHaveLength(3);
  await advance(4000);
  expect(controller.items.map((item) => item.title)).toEqual(["第二条", "第三条"]);
});

it("关闭、逐出与卸载会清理通知计时器", async () => {
  await render(<Harness />);
  await push({ level: "info", title: "关闭我" });
  expect(vi.getTimerCount()).toBe(1);
  await click(cards()[0].querySelector<HTMLButtonElement>(".toast-close")!);
  expect(vi.getTimerCount()).toBe(0);
  await push(
    { level: "info", title: "逐出我" },
    { level: "warning", title: "保留一" },
    { level: "warning", title: "保留二" },
  );
  expect(vi.getTimerCount()).toBe(1);
  await push({ level: "warning", title: "保留三" });
  expect(vi.getTimerCount()).toBe(0);
  await push({ level: "success", title: "卸载我" });
  expect(vi.getTimerCount()).toBe(1);
  await render(null);
  expect(vi.getTimerCount()).toBe(0);
});

it("可执行同步操作，按钮不触发表单提交", async () => {
  const run = vi.fn();
  const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  await render(<form onSubmit={submit}><Harness /></form>);
  await push({ level: "success", title: "已保存", action: { label: "复制路径", run } });
  const action = cards()[0].querySelector<HTMLButtonElement>(".toast-action")!;
  expect(action.textContent).toBe("复制路径");
  await click(action);
  expect(run).toHaveBeenCalledTimes(1);
  expect(action.disabled).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it("异步操作期间暂停到期并阻止重复点击，成功后继续剩余计时", async () => {
  let resolve!: () => void;
  const run = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  await render(<Harness />);
  await push({ level: "success", title: "已保存", action: { label: "复制路径", run } });
  await advance(1000);
  const action = cards()[0].querySelector<HTMLButtonElement>(".toast-action")!;
  await click(action);
  expect(action.disabled).toBe(true);
  await click(action);
  expect(run).toHaveBeenCalledTimes(1);
  await advance(10000);
  expect(cards()).toHaveLength(1);
  await act(async () => { resolve(); });
  expect(action.disabled).toBe(false);
  await advance(2999);
  expect(cards()).toHaveLength(1);
  await advance(1);
  expect(cards()).toHaveLength(0);
});

it.each(["同步", "异步"])("%s操作失败可见且保留到手动关闭，不泄漏拒绝", async (mode) => {
  const run = mode === "同步"
    ? () => { throw new Error("剪贴板不可用"); }
    : () => Promise.reject(new Error("剪贴板不可用"));
  await render(<Harness />);
  await push({ level: "success", title: "计划已保存", action: { label: "复制路径", run } });
  await click(cards()[0].querySelector<HTMLButtonElement>(".toast-action")!);
  expect(cards()[0].classList.contains("toast-error")).toBe(true);
  expect(cards()[0].textContent).toContain("操作失败：剪贴板不可用");
  await advance(60000);
  expect(cards()).toHaveLength(1);
  await click(cards()[0].querySelector<HTMLButtonElement>(".toast-close")!);
  expect(cards()).toHaveLength(0);
});

it("操作尚未完成时可以关闭，之后的拒绝也被处理", async () => {
  let reject!: (error: Error) => void;
  await render(<Harness />);
  await push({ level: "info", title: "复制中", action: {
    label: "复制路径",
    run: () => new Promise<void>((_resolve, fail) => { reject = fail; }),
  } });
  await click(cards()[0].querySelector<HTMLButtonElement>(".toast-action")!);
  await click(cards()[0].querySelector<HTMLButtonElement>(".toast-close")!);
  await act(async () => { reject(new Error("已关闭后的失败")); });
  expect(cards()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
