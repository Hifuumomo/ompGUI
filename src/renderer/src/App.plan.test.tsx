import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { container, render } from "./transcript-test-harness";
import { offPlanBridge } from "./plan-test-fixture";
import type { PlanAction, PlanChoice, PlanSnapshot } from "../../shared/native-plan";
import type { RpcCommand, RpcFrame, SessionEntry } from "../../shared/protocol";

vi.mock("./PlanEditor", () => ({ PlanEditor: () => <div role="textbox" aria-label="计划正文"><h1>计划概览</h1><h2>实施步骤</h2></div> }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem("omp-desktop.plan-choice"); });
async function mount(options: { asyncRefine?: boolean } = {}) {
  const listeners = new Set<(frame: RpcFrame) => void>();
  let snapshot: PlanSnapshot = { identity: { sessionId: "plan-test", sessionFile: "D:/plan.jsonl", epoch: "epoch" }, phase: "off", busy: false };
  let session = snapshot.identity;
  let operationSequence = 0;
  let history: { entries: SessionEntry[]; leafId: string | null } = { entries: [], leafId: null };
  let streaming = false;
  const copyText = vi.fn(async (_text: string) => {});
  const request = vi.fn(async (command: RpcCommand) => {
    switch (command.type) {
      case "get_state": return { sessionId: session.sessionId, sessionFile: session.sessionFile, isSettled: true, isStreaming: streaming };
      case "get_entries": return history;
      case "get_tree": return { tree: [], leafId: null };
      case "get_btw_history": return { records: [] };
      case "get_available_commands": return { commands: [] };
      case "prompt": return { agentInvoked: false };
      case "model_hub": return {
        models: [{ id: "execution-id", provider: "test", name: "执行模型显示名", selector: "test/execution-id", kind: "chat", allowedRoles: [], thinkingLevels: [], contextWindow: 100000 }],
        roles: [], providers: [{ id: "test", locked: false, oauth: false, count: 1 }],
        recent: [], cycleOrder: [], fallbackChains: {}, presets: { names: [] }, storage: "global", currentSelector: "test/execution-id", query: "", matches: [],
      };
      default: throw new Error(`unexpected request ${command.type}`);
    }
  });
  const plan = vi.fn(async (action: PlanAction) => {
    if (action.op === "enter") snapshot = { ...snapshot, phase: "planning" };
    else if (action.op === "pause") snapshot = { ...snapshot, phase: "paused" };
    else if (action.op === "leave") snapshot = { ...snapshot, phase: "off" };
    else if (action.op === "decide") {
      snapshot = {
        ...snapshot,
        phase: action.choice === "refine" && !options.asyncRefine ? "planning" : "applying",
        busy: action.choice !== "refine" || Boolean(options.asyncRefine),
        reviewId: action.choice === "refine" && !options.asyncRefine ? undefined : snapshot.reviewId,
        executionModel: action.executionModel,
        operation: { id: `operation-${++operationSequence}`, choice: action.choice, status: action.choice === "refine" && !options.asyncRefine ? "completed" : "running", origin: action.identity },
      };
    }
    else if (action.op !== "status") throw new Error(`unexpected plan action ${action.op}`);
    return snapshot;
  });
  vi.stubGlobal("desktop", { ...offPlanBridge, preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }), setZoomFactor() {}, listSessions: async () => [], request, plan, copyText, onFrame: (fn: (frame: RpcFrame) => void) => { listeners.add(fn); return () => listeners.delete(fn); } });
  await render(<App />);
  const emit = (frame: RpcFrame) => listeners.forEach((fn) => fn(frame));
  await act(async () => { emit({ type: "desktop_status", status: "connected" }); emit({ type: "session_info_update" }); });
  const updatePlan = async (next: Partial<PlanSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    if (next.identity) session = next.identity;
    await act(async () => emit({ type: "plan_state", snapshot }));
  };
  const finish = async (status: "completed" | "cancelled" | "failed", options: { migrate?: boolean; phase?: PlanSnapshot["phase"]; error?: string; savedPath?: string } = {}) => {
    if (!snapshot.operation) throw new Error("测试必须先启动真实计划处置");
    const identity = options.migrate ? { sessionId: "next-session", sessionFile: "D:/next-session.jsonl", epoch: "next-epoch" } : snapshot.identity;
    await updatePlan({
      identity, phase: options.phase ?? (status === "completed" ? "off" : "review"), busy: false, error: options.error,
      operation: { ...snapshot.operation, status, error: options.error, savedPath: options.savedPath },
    });
  };
  return { request, plan, emit, updatePlan, finish, copyText, setHistory(entries: SessionEntry[], busy = false) { history = { entries, leafId: entries.at(-1)?.id ?? null }; streaming = busy; } };
}
async function send(text: string) {
  await act(async () => {
    const textarea = container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
}
it("/plan 无参数只开启原生规划，不请求模型或提前打开审阅", async () => {
  const api = await mount(); await send("/plan");
  expect(container.querySelector(".workspace-title [role='status']")?.textContent).toContain("计划模式 ·");
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toEqual([]);
  expect(container.querySelector(".plan-pane")).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!.value).toBe("");
});
it("/plan 任务只发送任务原文，不将命令作为模型提示词", async () => {
  const api = await mount(); await send("/plan 调研边界并编写计划");
  const prompts = api.request.mock.calls.filter(([command]) => command.type === "prompt");
  expect(prompts).toHaveLength(1);
  expect(prompts[0][0]).toMatchObject({ message: "调研边界并编写计划" });
  expect(container.querySelector(".plan-pane")).toBeNull();
});
it("原生三态依次进入、暂停、退出，无空模型轮次", async () => {
  const api = await mount();
  await send("/plan");
  expect(container.querySelector(".workspace-title [role='status']")?.textContent).toContain("计划模式 ·");
  await send("/plan");
  expect(container.querySelector(".workspace-title [role='status']")?.textContent).toBe("计划模式已暂停");
  await send("/plan");
  expect(container.querySelector(".workspace-title [role='status']")).toBeNull();
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toEqual([]);
});
it("普通 local 写入及助手文本不是正式提案，不能生成审阅权限", async () => {
  const api = await mount(); await send("/plan");
  await act(async () => {
    api.emit({ type: "tool_execution_end", toolName: "write", result: { content: [{ type: "text", text: "local://PLAN.md" }] }, isError: false });
    api.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "计划已保存，请用 xd://propose 审阅" }] } });
  });
  expect(container.querySelector(".plan-pane")).toBeNull();
  expect(container.querySelector('[aria-label="计划待审阅"]')).toBeNull();
});

async function review(api: { updatePlan: (next: Partial<PlanSnapshot>) => Promise<void> }, reviewId = "review") {
  await api.updatePlan({
    phase: "review", reviewId,
    document: { path: "local://PLAN.md", title: "Plan", content: "# 计划概览\n\n## 实施步骤", revision: "revision", saveFileName: "PLAN.md" },
  });
}
function composer() { return container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!; }
async function refine() {
  const button = [...container.querySelectorAll<HTMLButtonElement>(".plan-bar button")].find((item) => item.textContent?.includes("继续完善"))!;
  await act(async () => button.click());
}
it("继续完善聚焦主输入框，发送时先退回规划再原样发送意见并清除提示", async () => {
  const api = await mount();
  await review(api);
  expect(container.querySelector(".plan-pane")).not.toBeNull();
  await refine();
  expect(container.querySelector(".toasts")?.textContent).toContain("继续完善计划：在下方输入意见，发送后退回规划");
  expect(document.activeElement).toBe(composer());
  expect(composer().placeholder).toBe("输入完善意见，发送即退回规划");
  expect(api.plan.mock.calls.some(([action]) => action.op === "decide")).toBe(false);
  await send("补充验证边界");
  const decisions = api.plan.mock.calls.filter(([action]) => action.op === "decide");
  expect(decisions).toHaveLength(1);
  expect(decisions[0][0]).toMatchObject({ op: "decide", choice: "refine", reviewId: "review", feedback: "补充验证边界" });
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(0);
  expect(composer().placeholder).not.toBe("输入完善意见，发送即退回规划");
  expect(composer().value).toBe("");
  expect(container.querySelector(".toasts")?.textContent).toContain("已退回规划，计划模式继续");
  await review(api, "review-again");
  expect(composer().placeholder).not.toBe("输入完善意见，发送即退回规划");
});
it("审阅阶段离开后清除完善提示，再次审阅不恢复旧提示", async () => {
  const api = await mount();
  await review(api);
  await refine();
  expect(composer().placeholder).toBe("输入完善意见，发送即退回规划");
  await api.updatePlan({ phase: "planning", reviewId: undefined });
  expect(composer().placeholder).not.toBe("输入完善意见，发送即退回规划");
  await review(api, "next-review");
  expect(composer().placeholder).not.toBe("输入完善意见，发送即退回规划");
});
it("完善提示不改变slash命令路由，发送后即使仍在review也清除提示", async () => {
  const api = await mount();
  await review(api);
  await refine();
  await send("/help");
  expect(api.plan.mock.calls.some(([action]) => action.op === "decide")).toBe(false);
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt").map(([command]) => command)).toEqual([
    expect.objectContaining({ message: "/help" }),
  ]);
  expect(composer().placeholder).not.toBe("输入完善意见，发送即退回规划");
  expect(container.querySelector(".plan-pane")).not.toBeNull();
});

/** 按真实侧栏菜单启动处置，以便记录所选模型显示名和原会话身份。 */
async function choose(choice: Exclude<PlanChoice, "refine">) {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="选择计划处置方式"]')!.click());
  const labels = { compact: "批准并压缩执行", keep: "批准并保留上下文", execute: "批准并新会话执行", save: "保存并新建会话" };
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent?.includes(labels[choice]))!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

it.each([
  ["compact", "计划已批准 · 已压缩上下文", "使用 执行模型显示名 执行"],
  ["keep", "计划已批准 · 保留上下文", "使用 执行模型显示名 执行"],
  ["execute", "计划已批准 · 已开始新会话", "计划与本地依赖已复制，使用 执行模型显示名 执行"],
  ["save", "计划已保存到 D:/saved/PLAN.md", "已新建会话"],
] as const)("%s 终态显示准确通知，重复帧和状态刷新不重复，新会话仍保留", async (choice, title, detail) => {
  const api = await mount();
  await review(api);
  await choose(choice);
  expect(container.querySelector(".toast")).toBeNull();
  const action = api.plan.mock.calls.find(([item]) => item.op === "decide")![0];
  expect(action).toMatchObject({ choice, identity: { sessionId: "plan-test", sessionFile: "D:/plan.jsonl", epoch: "epoch" } });
  await api.finish("completed", { migrate: choice === "execute" || choice === "save", savedPath: choice === "save" ? "D:/saved/PLAN.md" : undefined });
  expect(container.querySelectorAll(".toast")).toHaveLength(1);
  expect(container.querySelector(".toast-success")?.textContent).toContain(title);
  expect(container.querySelector(".toast-success")?.textContent).toContain(detail);
  await api.updatePlan({});
  await act(async () => api.emit({ type: "session_info_update" }));
  expect(container.querySelectorAll(".toast")).toHaveLength(1);
  expect(container.querySelector(".toast-success")?.textContent).toContain(title);
  if (choice === "execute" || choice === "save") {
    expect(api.request.mock.results.filter((_, index) => api.request.mock.calls[index][0].type === "get_state").length).toBeGreaterThan(1);
    expect(container.querySelector(".plan-pane")).toBeNull();
  }
  if (choice === "save") {
    const copy = [...container.querySelectorAll<HTMLButtonElement>(".toast button")].find((item) => item.textContent === "复制路径")!;
    await act(async () => copy.click());
    expect(api.copyText).toHaveBeenCalledWith("D:/saved/PLAN.md");
  }
});

it.each([
  ["review", "已停止处置，计划仍可审阅", undefined],
  ["off", "计划已批准，但压缩被取消，尚未开始执行", "发送一条消息以继续"],
] as const)("压缩取消返回 %s 时按真实状态显示警告", async (phase, title, detail) => {
  const api = await mount();
  await review(api);
  await choose("compact");
  await api.finish("cancelled", { phase });
  expect(container.querySelectorAll(".toast")).toHaveLength(1);
  expect(container.querySelector(".toast-warning")?.textContent).toContain(title);
  if (detail) expect(container.querySelector(".toast-warning")?.textContent).toContain(detail);
  expect(container.querySelector(".connection-banner")).toBeNull();
});

it("处置失败仅显示错误通知，重复终态不生成错误横幅或重复通知", async () => {
  const api = await mount();
  await review(api);
  await choose("keep");
  await api.finish("failed", { error: "执行模型不可用" });
  await api.updatePlan({});
  expect(container.querySelectorAll(".toast-error")).toHaveLength(1);
  expect(container.querySelector(".toast-error")?.textContent).toContain("执行计划失败");
  expect(container.querySelector(".toast-error")?.textContent).toContain("执行模型不可用");
  expect(container.querySelector(".connection-banner")).toBeNull();
  expect(container.querySelector(".plan-banner")).toBeNull();
});

it("info 与 warning notify 原样展示；状态、控件、标题帧不生成通知", async () => {
  const api = await mount();
  await act(async () => {
    for (const method of ["setStatus", "setWidget", "setTitle"]) {
      api.emit({ type: "extension_ui_request", id: method, method, notifyType: "info", message: "不可显示的状态文本" });
    }
    api.emit({ type: "extension_ui_request", id: "info", method: "notify", notifyType: "info", message: "扩展原始信息\n第二行" });
    api.emit({ type: "extension_ui_request", id: "warning", method: "notify", notifyType: "warning", message: "计划自动保存失败：磁盘只读" });
  });
  expect(container.querySelectorAll(".toast")).toHaveLength(2);
  expect(container.querySelector(".toast-info")?.textContent).toContain("扩展原始信息\n第二行");
  expect(container.querySelector(".toast-warning")?.textContent).toContain("计划自动保存失败：磁盘只读");
  expect(container.querySelector(".toasts")?.textContent).not.toContain("不可显示的状态文本");
  expect(container.querySelector(".connection-banner")).toBeNull();
});

it("error notify 保持现有错误横幅，不重复弹出通知", async () => {
  const api = await mount();
  await act(async () => api.emit({ type: "extension_ui_request", id: "error", method: "notify", notifyType: "error", message: "扩展操作失败" }));
  expect(container.querySelector(".connection-banner")?.textContent).toContain("扩展操作失败");
  expect(container.querySelector(".toast")).toBeNull();
});

it("复制已保存路径失败时保留成功通知并显示错误通知，不产生未处理拒绝", async () => {
  const api = await mount();
  await review(api);
  await choose("save");
  await api.finish("completed", { migrate: true, savedPath: "D:/saved/PLAN.md" });
  api.copyText.mockRejectedValueOnce(new Error("剪贴板不可用"));
  const copy = [...container.querySelectorAll<HTMLButtonElement>(".toast button")].find((item) => item.textContent === "复制路径")!;
  await act(async () => copy.click());
  expect(api.copyText).toHaveBeenCalledWith("D:/saved/PLAN.md");
  expect(container.querySelectorAll(".toast-success")).toHaveLength(1);
  expect(container.querySelector(".toast-error")?.textContent).toContain("剪贴板不可用");
  expect(container.querySelector(".connection-banner")).toBeNull();
});

it("较早处置终态在下一次操作完成后重发也不重复通知", async () => {
  const api = await mount();
  await review(api);
  await choose("keep");
  await api.finish("completed");
  await review(api, "second-review");
  await choose("compact");
  await api.finish("completed");
  expect(container.querySelectorAll(".toast")).toHaveLength(2);
  await api.updatePlan({
    operation: {
      id: "operation-1", choice: "keep", status: "completed",
      origin: { sessionId: "plan-test", sessionFile: "D:/plan.jsonl", epoch: "epoch" },
    },
  });
  expect(container.querySelectorAll(".toast")).toHaveLength(2);
});

it("执行回合仍在生成时立即补入落盘状态卡，不替换实时助手正文", async () => {
  const api = await mount();
  await review(api);
  await choose("keep");
  await act(async () => {
    api.emit({ type: "agent_start" });
    api.emit({ type: "message_start", messageId: "live-answer", message: { role: "assistant", content: "正在迁移客户端", timestamp: 30 } });
  });
  api.setHistory([{
    id: "status", parentId: null, type: "custom", customType: "ompgui-plan-status",
    timestamp: new Date(20).toISOString(),
    data: { version: 1, operationId: "operation-1", kind: "approved", choice: "keep", planPath: "local://PLAN.md", model: { provider: "test", modelId: "execution-id", name: "执行模型显示名" } },
  }], true);
  await api.finish("completed");
  expect(container.querySelectorAll(".plan-status-card")).toHaveLength(1);
  expect(container.querySelector(".plan-status-card")?.textContent).toContain("执行模型显示名");
  expect(container.textContent).toContain("正在迁移客户端");
  await act(async () => api.emit({ type: "message_end", messageId: "live-answer", message: { role: "assistant", content: "客户端迁移已完成", timestamp: 30 } }));
  expect(container.textContent).toContain("客户端迁移已完成");
  expect(container.querySelectorAll(".plan-status-card")).toHaveLength(1);
});

it("异步退回完成后继续发送当前意见，不因通知和历史刷新停在草稿框", async () => {
  const api = await mount({ asyncRefine: true });
  await review(api);
  await send("补充并发和失败恢复的验收边界");
  expect(api.plan.mock.calls.find(([action]) => action.op === "decide")?.[0]).toMatchObject({
    choice: "refine", feedback: "补充并发和失败恢复的验收边界",
  });
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(0);
  expect(composer().value).toBe("补充并发和失败恢复的验收边界");
  await api.finish("completed", { phase: "planning" });
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(0);
  expect(composer().value).toBe("");
});

it.each(["failed", "cancelled"] as const)("完善%s时保留意见草稿，不能再次作为独立提示词发送", async (status) => {
  const api = await mount({ asyncRefine: true });
  await review(api);
  await send("补充回滚条件");
  await api.finish(status, { phase: "planning", error: "原生未接收完善回合" });
  expect(composer().value).toBe("补充回滚条件");
  expect(api.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(0);
  expect(container.querySelector(status === "failed" ? ".toast-error" : ".toast-warning")).not.toBeNull();
});
