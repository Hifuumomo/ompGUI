import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { BtwRecord, RpcCommand, RpcFrame } from "../../shared/protocol";
import { offPlanBridge } from "./plan-test-fixture";
import { container, render } from "./transcript-test-harness";
import App from "./App";

const summary = { path: "D:/sessions/one.jsonl", id: "one", cwd: "D:/workspace", title: "旁问验证", timestamp: "2026-10-15", modified: 1 };
const topic: BtwRecord = { id: "topic-one", leafId: null, question: "历史问题", answer: "历史答案", status: "complete", createdAt: 1, updatedAt: 2 };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 真 App、严格原生边界，可暂停接受和历史以验证用户可见的竞态。 */
async function mount(options: { connected?: boolean; records?: BtwRecord[]; busy?: boolean } = {}) {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const known: Record<string, unknown> = {
    get_state: { sessionId: summary.id, sessionFile: summary.path, isStreaming: !!options.busy, isCompacting: false, isSettled: !options.busy, messageCount: 0, queuedMessageCount: 0 },
    get_entries: { entries: [], leafId: null }, get_tree: { tree: [], leafId: null },
    get_btw_history: { records: options.records ?? [] }, get_available_commands: { commands: [] }, abort: {}, btw_cancel: {},
  };
  const handlers: Record<string, (command: RpcCommand) => unknown> = {};
  const request = vi.fn(async (command: RpcCommand) => {
    if (handlers[command.type]) return handlers[command.type](command);
    if (!Object.hasOwn(known, command.type)) throw new Error(`意外 RPC：${command.type}`);
    return known[command.type];
  });
  const start = vi.fn(async () => ({ executable: "omp.exe", cwd: summary.cwd, protocolVersion: 2 }));
  const copyText = vi.fn(async () => {});
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {}, preferences: async () => ({ executable: "omp.exe", cwd: summary.cwd }),
    listSessions: async () => [summary], openSession: async () => ({ snapshot: { summary, messages: [] } }),
    start, request, copyText, prepareModels: async () => ({}), ...offPlanBridge,
    navigateTree: async () => {},
    onFrame: (listener: (frame: RpcFrame) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  await render(<App />);
  const emit = async (frame: RpcFrame) => { await act(async () => listeners.forEach(listener => listener(frame))); };
  if (options.connected) {
    await emit({ type: "desktop_status", status: "connected" });
    await emit({ type: "session_info_update" });
  }
  return { request, start, emit, handlers, known, copyText };
}

function main() { return container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!; }
function editor() { return container.querySelector<HTMLTextAreaElement>(".btw-panel textarea")!; }
function reader() { return container.querySelector<HTMLElement>('[aria-label="旁问阅读区"]'); }
function history() { return container.querySelector<HTMLElement>('[role="dialog"][aria-label="旁问历史"]'); }
async function newTopic() { await clickText("新主题"); expect(document.activeElement).toBe(editor()); }
async function input(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(element: EventTarget, value: string, options: KeyboardEventInit = {}) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options })); });
}
async function command(value = "/btw") { await input(main(), value); await key(main(), "Enter"); }
async function followUp() {
  await key(document.activeElement!, "f");
  expect(document.activeElement).toBe(editor());
}
async function closeEditor() {
  expect(document.activeElement).toBe(editor());
  await key(editor(), "Escape");
  expect(document.activeElement).toBe(history() ? reader() : container.querySelector(".btw-panel"));
  await clickText("收起旁问");
}
async function clickText(text: string, root: ParentNode = container) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text || item.getAttribute("aria-label") === text || (text === "展开" && item.textContent?.trim().endsWith("展开")));
  expect(button, `按钮 ${text}`).toBeDefined();
  await act(async () => button!.click());
}

it.each(["/btw", "/btw history"])("离线 %s 立即打开，不连接且收起恢复主选区", async value => {
  const api = await mount();
  await command(value);
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  expect(container.querySelector(".btw-panel")?.textContent).toContain("连接后可读取旁问历史");
  expect(api.start).not.toHaveBeenCalled(); expect(api.request).not.toHaveBeenCalled();
  await key(window, "Escape");
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(document.activeElement).toBe(main());
});

it.each([0, 1, 2].flatMap(count => ["命令", "历史命令", "slash候选", "状态条"].map(entry => ({ count, entry }))))(
  "$count 条历史从 $entry 打开默认整体，Esc 恢复主输入",
  async ({ count, entry }) => {
    const records = [topic, { ...topic, id: "two", question: "第二主题", answer: "第二答案" }].slice(0, count);
    const api = await mount({ connected: true, records });
    if (entry === "slash候选") {
      await input(main(), "/bt");
      const candidate = [...container.querySelectorAll<HTMLButtonElement>(".slash-menu button")].find(button => button.querySelector("strong")?.textContent === "/btw");
      expect(candidate).toBeDefined();
      await act(async () => candidate!.click());
    } else {
      await command(entry === "历史命令" ? "/btw history" : "/btw");
      if (entry === "状态条") {
        if (count === 0) {
          await newTopic(); await input(editor(), "空历史新主题草稿"); await closeEditor();
        } else {
          await followUp(); await input(editor(), "保留的追问草稿"); await closeEditor();
        }
        await clickText("展开", container.querySelector(".btw-status-bar")!);
      }
    }
    const panel = container.querySelector<HTMLElement>(".btw-panel")!;
    expect(document.activeElement).toBe(panel);
    expect(panel).toBe(history());
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(editor()).toBeNull();
    if (count > 1) expect(panel.querySelector('[aria-selected="true"]')?.textContent).toContain("历史问题");
    else if (count === 1) expect(panel.querySelector('[aria-label="旁问阅读区"]')?.textContent).toContain("历史答案");
    if (count === 0) {
      for (const value of ["ArrowDown", "ArrowUp", "Home", "End", "c", "f", "Enter"]) await key(panel, value);
      expect(document.activeElement).toBe(panel);
      expect(api.copyText).not.toHaveBeenCalled();
    }
    await key(panel, "Escape");
    expect(container.querySelector(".btw-panel")).toBeNull();
    expect(document.activeElement).toBe(main());
    expect(api.request.mock.calls.some(([c]) => c.type === "btw" || c.type === "abort" || c.type === "btw_cancel")).toBe(false);
  },
);

it.each(["新主题", "输入Esc返回阅读"])("迟到历史不抢 %s 的焦点，也不绑定新主题草稿", async entry => {
  const api = await mount({ connected: true });
  const { promise, resolve } = Promise.withResolvers<unknown>();
  api.handlers.get_btw_history = () => promise;
  await command();
  await newTopic();
  expect(document.activeElement).toBe(editor());
  await input(editor(), "未绑定的新主题草稿");
  await act(async () => { editor().setSelectionRange(2, 5, "backward"); editor().dispatchEvent(new Event("select", { bubbles: true })); });
  if (entry === "输入Esc返回阅读") await key(editor(), "Escape");
  const focusBeforeLoad = document.activeElement;
  await act(async () => resolve({ records: [topic, { ...topic, id: "two", question: "第二主题" }] }));
  expect(document.activeElement).toBe(focusBeforeLoad);
  expect(container.querySelector('[aria-selected="true"]')).toBeNull();
  expect(container.querySelector(".btw-panel")?.textContent).not.toContain("历史答案");
  if (document.activeElement === editor()) await key(editor(), "Escape");
  expect(document.activeElement).toBe(reader());
  await newTopic();
  expect(editor().value).toBe("未绑定的新主题草稿");
  expect([editor().selectionStart, editor().selectionEnd, editor().selectionDirection]).toEqual([2, 5, "backward"]);
  expect(api.request.mock.calls.some(([c]) => c.type === "btw" || c.type === "abort" || c.type === "btw_cancel")).toBe(false);
});

it("整体 F 编辑、Esc 返回后 C 复制与上下切换保留中文选区", async () => {
  const api = await mount({ connected: true, records: [topic, { ...topic, id: "two", question: "第二主题", answer: "第二答案" }] });
  await command();
  const panel = container.querySelector<HTMLElement>(".btw-panel")!;
  expect(document.activeElement).toBe(panel);
  await key(panel, "f");
  expect(document.activeElement).toBe(editor());
  await input(editor(), "中文追问草稿");
  await act(async () => { editor().setSelectionRange(1, 4, "backward"); editor().dispatchEvent(new Event("select", { bubbles: true })); });
  await key(editor(), "Escape");
  expect(document.activeElement).toBe(reader());
  await key(document.activeElement!, "c");
  expect(api.copyText).toHaveBeenCalledWith("历史答案");
  const requestsBeforeNavigation = api.request.mock.calls.length;
  await key(document.activeElement!, "ArrowLeft");
  const list = container.querySelector<HTMLElement>('[aria-label="旁问主题"]')!;
  await key(list, "End"); await key(list, "ArrowDown");
  expect(document.activeElement).toBe(list);
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("第二主题");
  await key(list, "Home"); await key(list, "ArrowUp");
  expect(document.activeElement).toBe(list);
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("历史问题");
  expect(api.request.mock.calls).toHaveLength(requestsBeforeNavigation);
  await key(list, "ArrowDown");
  expect(document.activeElement).toBe(list);
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("第二主题");
  await key(list, "ArrowUp"); await key(list, "f");
  expect(editor().value).toBe("中文追问草稿");
  expect([editor().selectionStart, editor().selectionEnd, editor().selectionDirection]).toEqual([1, 4, "backward"]);
  expect(api.request.mock.calls.some(([c]) => c.type === "abort" || c.type === "btw_cancel")).toBe(false);
});

it("默认整体聚焦，中文草稿收起重开保留，空白和组合键不提交", async () => {
  const api = await mount(); await command(); await newTopic();
  expect(document.activeElement).toBe(editor());
  await input(editor(), "中文下一问");
  await key(editor(), "Enter", { shiftKey: true });
  await key(editor(), "Enter", { isComposing: true });
  await key(editor(), "Escape", { isComposing: true });
  expect(editor().value).toBe("中文下一问");
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  await closeEditor();
  await command(); await newTopic(); expect(editor().value).toBe("中文下一问");
  await input(editor(), "  "); await key(editor(), "Enter");
  expect(api.start).not.toHaveBeenCalled();
});

it("接受前可继续编辑，接受只消费提交版本并将新草稿迁到真实主题", async () => {
  const api = await mount({ connected: true });
  const { promise, resolve: accept } = Promise.withResolvers<unknown>();
  api.handlers.btw = () => promise;
  await command(); await newTopic(); await input(editor(), "第一问"); await key(editor(), "Enter");
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toHaveLength(1);
  await input(editor(), "等待时写的下一问"); await key(editor(), "Enter");
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toHaveLength(1);
  const running = { ...topic, question: "第一问", answer: "", status: "running" as const };
  api.known.get_btw_history = { records: [running] };
  await act(async () => accept({ record: running }));
  expect(editor().value).toBe("等待时写的下一问");
  expect(document.activeElement).toBe(editor());
  await closeEditor();
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("回答中");
  await command(); await key(document.activeElement!, "f");
  expect(editor()).toBeNull();
  await api.emit({ type: "btw_record", record: { ...running, answer: "第一问答案", status: "complete" } });
  await followUp(); expect(editor().value).toBe("等待时写的下一问");
});

it.each(["新主题", "追问"])("历史%s接受成功后关闭编辑器并返回阅读，不发送主聊天", async entry => {
  const api = await mount({ connected: true, records: [topic] });
  const acceptance = Promise.withResolvers<unknown>();
  api.handlers.btw = () => acceptance.promise;
  await command("/btw history");
  if (entry === "新主题") await newTopic(); else await followUp();
  await input(editor(), "已提交的问题");
  if (entry === "新主题") {
    const submit = history()!.querySelector<HTMLButtonElement>(".btw-panel-footer .primary")!;
    await act(async () => { submit.focus(); submit.click(); });
  } else await key(editor(), "Enter");
  const accepted: BtwRecord = entry === "新主题"
    ? { ...topic, id: "new-topic", question: "已提交的问题", answer: "", status: "running" as const }
    : { ...topic, followUps: [{ ...topic, question: "已提交的问题", answer: "", status: "running" as const }] };
  await act(async () => acceptance.resolve({ record: accepted }));
  expect(history()).not.toBeNull();
  expect(document.activeElement).toBe(reader());
  expect(reader()?.textContent).toContain("已提交的问题");
  expect(editor()).toBeNull();
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toEqual([[
    entry === "新主题" ? { type: "btw", question: "已提交的问题" } : { type: "btw", question: "已提交的问题", recordId: topic.id },
  ]]);
  expect(api.request.mock.calls.some(([c]) => c.type === "prompt" || c.type === "abort" || c.type === "btw_cancel")).toBe(false);
  await key(document.activeElement!, "f");
  expect(editor()).toBeNull();
  const completed: BtwRecord = accepted.followUps
    ? { ...accepted, followUps: accepted.followUps.map(turn => ({ ...turn, answer: "追问答案", status: "complete" })) }
    : { ...accepted, answer: "新主题答案", status: "complete" };
  await api.emit({ type: "btw_record", record: completed });
  await followUp();
  expect(editor().value).toBe("");
});

it.each(["退出编辑", "新主题", "操作按钮", "收起后重开"])("历史接受晚到不改变%s的当前交互", async interaction => {
  const api = await mount({ connected: true, records: [topic] });
  const acceptance = Promise.withResolvers<unknown>();
  api.handlers.btw = () => acceptance.promise;
  await command("/btw history"); await followUp();
  await input(editor(), "原主题提交"); await key(editor(), "Enter");
  if (interaction === "退出编辑") {
    await key(editor(), "Escape"); await key(document.activeElement!, "f");
    expect(editor()).toBeNull();
  } else if (interaction === "新主题") {
    await newTopic(); await input(editor(), "独立新草稿");
  } else if (interaction === "操作按钮") {
    const more = [...history()!.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "更多")!;
    await act(async () => more.focus());
  } else {
    await clickText("收起旁问"); await command("/btw history");
  }
  const active = document.activeElement;
  await act(async () => acceptance.resolve({ record: { ...topic, followUps: [{ ...topic, question: "原主题提交", answer: "", status: "running" }] } }));
  expect(document.activeElement).toBe(active);
  expect(history()).not.toBeNull();
  if (interaction === "新主题") expect(editor().value).toBe("独立新草稿");
  else if (interaction === "收起后重开" || interaction === "退出编辑") expect(editor()).toBeNull();
  else expect(editor()).not.toBeNull();
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toHaveLength(1);
});

it("问题命令只发一次，拒绝保留主命令，且不发送 prompt", async () => {
  const api = await mount({ connected: true });
  api.handlers.btw = () => { throw new Error("原生拒绝旁问"); };
  await command("/btw 解释中文错误");
  expect(main().value).toBe("/btw 解释中文错误");
  expect(container.querySelector(".btw-panel")?.textContent).toContain("原生拒绝旁问");
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toEqual([[{ type: "btw", question: "解释中文错误" }]]);
  expect(api.request.mock.calls.some(([c]) => c.type === "prompt")).toBe(false);
});

it("编辑 Esc 返回阅读，repeat 不越级，关闭后500ms不穿透主任务", async () => {
  const api = await mount({ connected: true, busy: true, records: [topic] });
  await command(); await followUp(); vi.useFakeTimers();
  await key(editor(), "Escape", { repeat: true });
  expect(document.activeElement).toBe(editor());
  await key(window, "Escape");
  expect(document.activeElement).toBe(reader());
  await key(document.activeElement!, "Escape", { repeat: true });
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  await key(document.activeElement!, "Escape");
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(document.activeElement).toBe(main());
  await key(window, "Escape");
  vi.advanceTimersByTime(499); await key(window, "Escape");
  expect(api.request.mock.calls.some(([c]) => c.type === "abort" || c.type === "btw_cancel")).toBe(false);
  vi.advanceTimersByTime(1); await key(window, "Escape");
  expect(api.request.mock.calls.filter(([c]) => c.type === "abort")).toHaveLength(1);
});

it("运行主题编辑 Esc 不停止，阅读 Esc 先停止所选主题，完成后再次 Esc 才关闭", async () => {
  const api = await mount({ connected: true, busy: true, records: [topic] });
  const cancellation = Promise.withResolvers<unknown>();
  api.handlers.btw_cancel = () => cancellation.promise;
  await command(); await followUp(); await input(editor(), "停止后仍保留的追问");
  await api.emit({ type: "btw_record", record: { ...topic, status: "running" } });
  await key(editor(), "Escape");
  expect(document.activeElement).toBe(reader());
  expect(api.request.mock.calls.some(([c]) => c.type === "btw_cancel" || c.type === "abort")).toBe(false);
  await key(document.activeElement!, "Escape");
  expect(history()).not.toBeNull();
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw_cancel")).toEqual([[{ type: "btw_cancel", recordId: topic.id }]]);
  await key(document.activeElement!, "Escape", { repeat: true });
  expect(history()).not.toBeNull();
  api.known.get_btw_history = { records: [{ ...topic, status: "cancelled" }] };
  await act(async () => cancellation.resolve({}));
  await key(document.activeElement!, "Escape");
  expect(history()).toBeNull();
  expect(document.activeElement).toBe(main());
  expect(api.request.mock.calls.some(([c]) => c.type === "abort")).toBe(false);
  await command(); await followUp();
  expect(editor().value).toBe("停止后仍保留的追问");
});

it("后台停止携带实际 running ID，失败不伪造已停止", async () => {
  const api = await mount({ connected: true, records: [{ ...topic, status: "running" }] });
  api.handlers.btw_cancel = () => { throw new Error("停止失败"); };
  await command(); await clickText("收起旁问");
  await clickText("停止", container.querySelector(".btw-status-bar")!);
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw_cancel")).toEqual([[{ type: "btw_cancel", recordId: topic.id }]]);
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("回答中");
  expect(api.request.mock.calls.some(([c]) => c.type === "abort")).toBe(false);
});

it("接受前的完成事件按序重放，不能被旧 running 快照覆盖", async () => {
  const api = await mount({ connected: true });
  const { promise, resolve: accept } = Promise.withResolvers<unknown>();
  api.handlers.btw = () => promise;
  await command(); await newTopic(); await input(editor(), "提前完成"); await key(editor(), "Enter");
  await api.emit({ type: "btw_record", record: { ...topic, answer: "完整答案", status: "complete" } });
  await act(async () => accept({ record: { ...topic, answer: "", status: "running" } }));
  expect(container.querySelector(".btw-panel")?.textContent).toContain("完整答案");
  expect(container.querySelector(".btw-panel")?.textContent).not.toContain("回答中");
});

it("历史复制取最新非空原生答案，输入 C/F 不触发复制或导航", async () => {
  const record = { ...topic, followUps: [{ ...topic, question: "追问", answer: " 最新答案 \n" }] };
  const api = await mount({ connected: true, records: [record] });
  await command("/btw history");
  await clickText("复制答案"); expect(api.copyText).toHaveBeenCalledWith(" 最新答案 \n");
  await key(document.activeElement!, "Escape"); await command(); await followUp();
  await input(editor(), "cf"); await key(editor(), "c"); await key(editor(), "f");
  await key(editor(), "ArrowDown"); await key(editor(), "ArrowUp");
  expect(document.activeElement).toBe(editor());
  expect(container.querySelector('[aria-label="旁问阅读区"]')?.textContent).toContain("历史答案");
  expect(editor().value).toBe("cf"); expect(api.copyText).toHaveBeenCalledTimes(1);
});

it.each([false, true])("收起后的完成帧移除状态栏，保留主草稿和焦点（追问：%s）", async followUp => {
  const running: BtwRecord = followUp
    ? { ...topic, followUps: [{ ...topic, question: "追问问题", answer: "", status: "running" }] }
    : { ...topic, status: "running" };
  const api = await mount({ connected: true, records: [running] });
  await command(); await clickText("收起旁问");
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("回答中");
  await input(main(), "主任务草稿"); main().focus();
  const completed: BtwRecord = followUp
    ? { ...topic, followUps: [{ ...topic, question: "追问问题", answer: "后台完成" }] }
    : { ...topic, answer: "后台完成" };
  await api.emit({ type: "btw_record", record: completed });
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(main().value).toBe("主任务草稿"); expect(document.activeElement).toBe(main());
  expect(container.querySelector(".btw-status-bar")).toBeNull();
});

it("已完成历史收起不留状态栏，仍可通过命令重开答案", async () => {
  await mount({ connected: true, records: [topic] });
  await command(); await clickText("收起旁问");
  expect(container.querySelector(".btw-status-bar")).toBeNull();
  await command("/btw history");
  expect(reader()?.textContent).toContain(topic.answer);
  await clickText("收起旁问");
  expect(container.querySelector(".btw-status-bar")).toBeNull();
});

it("迟到历史不能覆盖已授权主题的流式内容", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command("/btw history"); await key(document.activeElement!, "Escape");
  const { promise, resolve } = Promise.withResolvers<unknown>();
  api.handlers.get_btw_history = () => promise;
  await command();
  await api.emit({ type: "btw_delta", recordId: topic.id, delta: "实时新增" });
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  await act(async () => resolve({ records: [topic] }));
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  expect(container.querySelector(".btw-panel")?.textContent).toContain("历史答案实时新增");
});

it("未知旁问事件不能认领当前会话，历史失败不伪装为空历史", async () => {
  const api = await mount({ connected: true });
  await api.emit({ type: "btw_record", record: topic });
  api.handlers.get_btw_history = () => { throw new Error("读取旁问历史失败"); };
  await command("/btw history");
  const text = container.querySelector(".btw-panel")?.textContent;
  expect(text).toContain("读取旁问历史失败");
  expect(text).not.toContain("历史答案");
});

it("主题草稿和新主题槽互不覆盖", async () => {
  await mount({ connected: true, records: [topic] });
  await command("/btw history"); await followUp(); await input(editor(), "历史主题草稿");
  await clickText("新主题"); await input(editor(), "新主题草稿");
  await act(async () => { editor().setSelectionRange(1, 4, "backward"); editor().dispatchEvent(new Event("select", { bubbles: true })); });
  await key(editor(), "Escape");
  expect(document.activeElement).toBe(reader());
  expect(container.querySelector('[aria-selected="true"]')).toBeNull();
  await newTopic();
  expect(editor().value).toBe("新主题草稿");
  expect([editor().selectionStart, editor().selectionEnd, editor().selectionDirection]).toEqual([1, 4, "backward"]);
  await closeEditor(); await command("/btw history"); await followUp();
  expect(editor().value).toBe("历史主题草稿");
  await clickText("新主题"); expect(editor().value).toBe("新主题草稿");
});

it("背景存储错误保留找回入口，刷新成功才解除警告", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command(); await key(document.activeElement!, "Escape");
  await api.emit({ type: "notice", source: "btw-history", level: "error", message: "磁盘写入失败" });
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("旁问历史保存失败");
  await command("/btw history");
  expect(container.querySelector(".btw-panel")?.textContent).toContain("磁盘写入失败");
  await clickText("刷新", container.querySelector(".btw-panel")!);
  expect(container.querySelector(".btw-panel")?.textContent).not.toContain("磁盘写入失败");
});

it("普通收起恢复主文本与精确选区，ShiftTab不修改主思考等级", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command(); await followUp(); await input(editor(), "未发送追问"); await closeEditor();
  await input(main(), "主草稿保持原样");
  main().setSelectionRange(1, 4, "backward");
  await clickText("展开", container.querySelector(".btw-status-bar")!);
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  await followUp(); await key(editor(), "Tab", { shiftKey: true });
  await closeEditor();
  expect(main().value).toBe("主草稿保持原样");
  expect([main().selectionStart, main().selectionEnd, main().selectionDirection]).toEqual([1, 4, "backward"]);
  expect(api.request.mock.calls.some(([c]) => c.type === "set_thinking_level")).toBe(false);
});

it("命令接受晚到不清收起后新写的主草稿，也不重新打开面板", async () => {
  const api = await mount({ connected: true });
  const { promise, resolve } = Promise.withResolvers<unknown>();
  api.handlers.btw = () => promise;
  await command("/btw 命令问题");
  expect(main().value).toBe("/btw 命令问题");
  await closeEditor();
  expect(main().disabled).toBe(false);
  await input(main(), "等待期间的新主草稿"); main().focus();
  await act(async () => resolve({ record: { ...topic, status: "running" } }));
  expect(main().value).toBe("等待期间的新主草稿");
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(document.activeElement).toBe(main());
});

it("历史权威删除主题后保留其草稿，但不能把追问误发成新主题", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command("/btw history"); await followUp(); await input(editor(), "不能丢的追问");
  api.known.get_btw_history = { records: [] };
  await clickText("刷新", container.querySelector(".btw-panel")!);
  expect(editor().value).toBe("不能丢的追问");
  expect(container.querySelector(".btw-panel")?.textContent).toContain("该旁问主题已不存在");
  await key(editor(), "Enter");
  expect(api.request.mock.calls.some(([c]) => c.type === "btw")).toBe(false);
});

it("切换只读会话使旧接受和增量失效，不清旧scope草稿", async () => {
  const api = await mount({ connected: true });
  const { promise, resolve } = Promise.withResolvers<unknown>();
  api.handlers.btw = () => promise;
  await command(); await newTopic(); await input(editor(), "原会话问题"); await key(editor(), "Enter");
  await act(async () => container.querySelector<HTMLButtonElement>(".session-item")!.click());
  await act(async () => resolve({ record: { ...topic, status: "running" } }));
  await api.emit({ type: "btw_delta", recordId: topic.id, delta: "旧会话增量" });
  expect(container.querySelector(".btw-panel")).toBeNull();
  await command(); await newTopic();
  expect(editor().value).toBe("原会话问题");
  expect(container.querySelector(".btw-panel")?.textContent).not.toContain("旧会话增量");
});

it("复制失败显示真实错误，不显示成功", async () => {
  const api = await mount({ connected: true, records: [topic] });
  api.copyText.mockRejectedValueOnce(new Error("剪贴板不可用"));
  await command("/btw history"); await clickText("复制答案");
  expect(container.querySelector(".btw-panel")?.textContent).toContain("剪贴板不可用");
  expect(container.querySelector(".btw-panel")?.textContent).not.toContain("已复制");
});

it("旁问命令接受只消费文字，主附件在打开、收起和接受后都保留", async () => {
  const api = await mount({ connected: true });
  const entries = [
    { id: "question", parentId: null, type: "message", timestamp: "2026-10-19T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "原主问题" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }] } },
    { id: "answer", parentId: "question", type: "message", timestamp: "2026-10-19T00:00:01Z", message: { role: "assistant", content: "原回答" } },
  ];
  api.known.get_entries = { entries, leafId: "answer" };
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  try {
    await api.emit({ type: "session_info_update" });
    for (const value of ["Escape", "Escape", "ArrowUp", "Enter"]) await key(document, value);
    const images = [...container.querySelectorAll(".draft-images img")].map(image => image.getAttribute("src"));
    expect(images).toEqual(["data:image/png;base64,aW1hZ2U="]);
    const { promise, resolve } = Promise.withResolvers<unknown>();
    api.handlers.btw = () => promise;
    await command("/btw 不发送主附件");
    expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toEqual([[{ type: "btw", question: "不发送主附件" }]]);
    await closeEditor();
    expect([...container.querySelectorAll(".draft-images img")].map(image => image.getAttribute("src"))).toEqual(images);
    await act(async () => resolve({ record: { ...topic, status: "running" } }));
    expect(main().value).toBe("");
    expect([...container.querySelectorAll(".draft-images img")].map(image => image.getAttribute("src"))).toEqual(images);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("组合结束同轮 Enter/Esc 与229尾键不误提交或收起", async () => {
  const api = await mount({ connected: true });
  await command(); await newTopic(); await input(editor(), "中文候选");
  vi.useFakeTimers();
  await act(async () => {
    editor().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    editor().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  expect(document.activeElement).toBe(editor());
  expect(api.request.mock.calls.some(([c]) => c.type === "btw")).toBe(false);
  await act(async () => vi.advanceTimersByTime(0));
  await key(editor(), "Enter", { keyCode: 229 });
  await key(editor(), "Escape", { keyCode: 229 });
  expect(document.activeElement).toBe(editor());
  expect(api.request.mock.calls.some(([c]) => c.type === "btw")).toBe(false);
  await closeEditor();
  expect(container.querySelector(".btw-panel")).toBeNull();
});

it("已有新主题草稿不被带问题命令认领或迁移", async () => {
  const api = await mount({ connected: true });
  await command(); await newTopic(); await input(editor(), "独立保留的新主题草稿"); await closeEditor();
  api.handlers.btw = () => ({ record: { ...topic, question: "命令问题" } });
  await command("/btw 命令问题");
  expect(main().value).toBe("");
  expect(editor().value).toBe("");
  expect(history()).toBeNull();
  expect(document.activeElement).toBe(editor());
  await clickText("新主题");
  expect(editor().value).toBe("独立保留的新主题草稿");
});

it("只读旁问明确提交才连接，占用失败保留草稿且不发送任何 prompt", async () => {
  const api = await mount();
  api.start.mockRejectedValueOnce(new Error("SESSION_OCCUPIED：会话被占用"));
  await act(async () => container.querySelector<HTMLButtonElement>(".session-item")!.click());
  await command();
  expect(api.start).not.toHaveBeenCalled();
  await newTopic(); await input(editor(), "等待安全连接的问题"); await key(editor(), "Enter");
  expect(api.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sessionPath: summary.path }));
  expect(editor().value).toBe("等待安全连接的问题");
  expect(container.textContent).toContain("SESSION_OCCUPIED");
  expect(api.request.mock.calls.some(([c]) => c.type === "btw" || c.type === "prompt")).toBe(false);
});

it("更多菜单的 Escape 只关菜单，再次 Escape 才收起旁问", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command("/btw history");
  const more = [...history()!.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "更多")!;
  await act(async () => more.click());
  const menu = document.querySelector('[role="menu"][aria-label="旁问更多操作"]')!;
  expect(menu).not.toBeNull();
  await key(menu, "Escape");
  expect(document.querySelector('[aria-label="旁问更多操作"]')).toBeNull();
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  expect(document.activeElement).toBe(more);
  await key(document.activeElement!, "f"); await key(document.activeElement!, "c");
  expect(document.activeElement).toBe(more);
  expect(api.copyText).not.toHaveBeenCalled();
  await key(document.activeElement!, "Escape");
  expect(container.querySelector(".btw-panel")).toBeNull();
  expect(api.request.mock.calls.some(([c]) => c.type === "abort" || c.type === "btw_cancel")).toBe(false);
});

it("历史列表键盘切换、详情与追问保持正确主题", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) });
  const second = { ...topic, id: "topic-two", question: "第二个主题", answer: "第二个答案" };
  const api = await mount({ connected: true, records: [topic, second] });
  await command("/btw history");
  const list = container.querySelector<HTMLElement>('[aria-label="旁问主题"]')!;
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  await act(async () => list.focus());
  expect(document.activeElement).toBe(list);
  await key(list, "End");
  expect(document.activeElement).toBe(list);
  expect(container.querySelector('[aria-label="旁问主题"]')).toBe(list);
  await key(list, "Home"); await key(list, "ArrowDown");
  expect(document.activeElement).toBe(list);
  await key(list, "ArrowRight");
  const reader = container.querySelector<HTMLElement>('[aria-label="旁问阅读区"]')!;
  expect(document.activeElement).toBe(reader);
  expect(reader.textContent).toContain("第二个答案");
  await act(async () => {
    Object.defineProperty(reader, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(reader, "clientHeight", { configurable: true, value: 100 });
    reader.scrollTop = 120;
  });
  await key(reader, "ArrowDown");
  expect(reader.scrollTop).toBeGreaterThan(120);
  expect(document.activeElement).toBe(reader);
  expect(reader.textContent).toContain("第二个主题");
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("第二个主题");
  await key(reader, "Tab", { shiftKey: true });
  expect(document.activeElement).toBe(list);
  await key(list, "Home");
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("历史问题");
  await key(list, "Tab");
  expect(document.activeElement).toBe(reader);
  await key(reader, "End");
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("历史问题");
  await key(reader, "/", { ctrlKey: true });
  expect(document.activeElement).toBe(list);
  await key(list, "End"); await key(list, "ArrowRight");
  expect(document.activeElement).toBe(reader);
  await key(reader, "c");
  expect(api.copyText).toHaveBeenCalledWith("第二个答案");
  await key(reader, "f"); expect(document.activeElement).toBe(editor());
  await input(editor(), "第二主题追问"); await closeEditor();
  await command(); await followUp();
  expect(editor().value).toBe("第二主题追问");
});

it("首次异步载入多主题历史后，原地获得列表选择而不抢焦点", async () => {
  const api = await mount({ connected: true, busy: true });
  const { promise, resolve } = Promise.withResolvers<unknown>();
  api.handlers.get_btw_history = () => promise;
  await command("/btw history");
  expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  await act(async () => resolve({ records: [topic, { ...topic, id: "two", question: "第二主题" }] }));
  const list = container.querySelector('[aria-label="旁问主题"]');
  expect(list).not.toBeNull(); expect(document.activeElement).toBe(container.querySelector(".btw-panel"));
  await key(document.activeElement!, "ArrowDown");
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("第二主题");
  await key(document.activeElement!, "Tab");
  expect(document.activeElement).toBe(reader());
  expect(reader()?.textContent).toContain("第二主题");
});

it("旁问激活仅在连接阶段锁主输入，不能重复连接打断原提问", async () => {
  const api = await mount();
  const activation = Promise.withResolvers<{ executable: string; cwd: string; protocolVersion: number }>();
  const acceptance = Promise.withResolvers<unknown>();
  api.start.mockReturnValueOnce(activation.promise);
  api.handlers.btw = () => acceptance.promise;
  await act(async () => container.querySelector<HTMLButtonElement>(".session-item")!.click());
  await command(); await newTopic(); await input(editor(), "需要激活的旁问"); await key(editor(), "Enter");
  await closeEditor();
  expect(main().disabled).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>(".send-button")!.click());
  expect(api.start).toHaveBeenCalledTimes(1);
  await act(async () => activation.resolve({ executable: "omp.exe", cwd: summary.cwd, protocolVersion: 2 }));
  expect(main().disabled).toBe(false);
  expect(document.activeElement).toBe(main());
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw")).toEqual([[{ type: "btw", question: "需要激活的旁问" }]]);
  await act(async () => acceptance.resolve({ record: { ...topic, status: "running" } }));
});

it("阅读已完成主题不会停止后台其他主题，选中运行主题才可停止且错误保留", async () => {
  const api = await mount({ connected: true, records: [topic, { ...topic, id: "running", question: "后台主题", status: "running" }] });
  api.handlers.btw_cancel = () => { throw new Error("后台停止失败"); };
  await command("/btw history");
  expect([...history()!.querySelectorAll("button")].some(button => button.textContent?.trim() === "停止")).toBe(false);
  await key(document.activeElement!, "Escape");
  expect(history()).toBeNull();
  expect(api.request.mock.calls.some(([c]) => c.type === "btw_cancel" || c.type === "abort")).toBe(false);
  await command("/btw history"); await key(document.activeElement!, "End");
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("后台主题");
  await clickText("停止", history()!);
  expect(api.request.mock.calls.filter(([c]) => c.type === "btw_cancel")).toEqual([[{ type: "btw_cancel", recordId: "running" }]]);
  expect(history()?.textContent).toContain("后台停止失败");
  await clickText("收起旁问");
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("操作失败");
  expect(container.querySelector(".btw-status-bar")?.textContent).toContain("回答中");
});

it("自动拒绝恢复读取不能清除已有历史保存警告", async () => {
  const api = await mount({ connected: true });
  await command();
  await api.emit({ type: "notice", source: "btw-history", level: "error", message: "保存警告仍有效" });
  api.handlers.btw = () => { throw new Error("旁问接受失败"); };
  await newTopic(); await input(editor(), "拒绝的问题"); await key(editor(), "Enter");
  expect(container.querySelector(".btw-panel")?.textContent).toContain("保存警告仍有效");
});

it("只有禁用菜单项时 Escape 仍可退出，明确发送不消费主草稿", async () => {
  const api = await mount({ connected: true, records: [topic] });
  await command(); await followUp(); await input(editor(), "未发送追问"); await closeEditor(); await input(main(), "保留主线草稿");
  await clickText("展开", container.querySelector(".btw-status-bar")!);
  const acceptance = Promise.withResolvers<unknown>();
  api.handlers.prompt = () => acceptance.promise;
  await clickText("更多"); await clickText("明确发送至主聊天", document);
  expect(main().value).toBe("保留主线草稿");
  await clickText("更多");
  const menu = document.querySelector<HTMLElement>('[aria-label="旁问更多操作"]')!;
  expect(menu.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(document.activeElement).toBe(menu);
  await key(menu, "Escape");
  expect(document.querySelector('[aria-label="旁问更多操作"]')).toBeNull();
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  await act(async () => acceptance.resolve({ agentInvoked: true }));
  expect(main().value).toBe("保留主线草稿");
});

it("全屏历史关闭后恢复已打开的后台任务侧栏和旁问草稿", async () => {
  const api = await mount({ connected: true });
  api.handlers.prompt = () => ({ agentInvoked: false, output: "No background jobs" });
  await command("/jobs");
  expect(container.querySelector('[aria-label="后台任务"]')).not.toBeNull();
  await command();
  expect(container.querySelector(".btw-panel")).not.toBeNull();
  expect(container.querySelector('[aria-label="后台任务"]')).not.toBeNull();
  expect(history()).not.toBeNull();
  await newTopic(); await input(editor(), "并存时的草稿"); await closeEditor();
  expect(container.querySelector('[aria-label="后台任务"]')).not.toBeNull();
  await clickText("展开", container.querySelector(".btw-status-bar")!);
  await newTopic(); expect(editor().value).toBe("并存时的草稿");
});
