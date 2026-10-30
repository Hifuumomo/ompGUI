import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcFrame, SessionEngineStatus, SessionState } from "../../shared/protocol";
import { offPlanBridge } from "./plan-test-fixture";
import { click, container, render } from "./transcript-test-harness";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

/** 真实 App 的独立引擎边界，直接交付各会话拥有的原生快照与帧。 */
async function mount() {
  const sessions = ["one", "two"].map((id) => ({ id, path: `D:/sessions/${id}.jsonl`, cwd: "D:/project", title: `会话 ${id}`, timestamp: "", modified: 1 }));
  const listeners = new Set<(frame: RpcFrame) => void>();
  let selected = sessions[0];
  let engines: SessionEngineStatus[] = [{ id: "engine-one", sessionPath: sessions[0].path, state: "active" }];
  const state = (): SessionState => ({ sessionId: selected.id, sessionFile: selected.path, isStreaming: selected.id === "one", isCompacting: false, isSettled: selected.id !== "one", messageCount: 1, queuedMessageCount: 0 });
  const start = vi.fn();
  const openSession = vi.fn(async (path: string) => {
    selected = sessions.find((session) => session.path === path)!;
    const engine = engines.find((entry) => entry.sessionPath === path);
    return { snapshot: { summary: selected, messages: [{ role: "user", content: `历史 ${selected.id}` }] }, engine: engine && {
      id: engine.id, connection: { engineId: engine.id, cwd: selected.cwd, executable: "omp.exe", protocolVersion: 2 }, state: state(),
      frames: [{ type: "message_start", engineId: engine.id, message: { role: "assistant", content: "正在生成 one" } }],
    } };
  });
  const request = vi.fn(async ({ type }: { type: string }) => {
    if (type === "get_state") return state();
    if (type === "get_entries") return { entries: [], leafId: null };
    if (type === "get_btw_history") return { records: [] };
    if (type === "get_available_commands") return { commands: [] };
    throw new Error(`意外 RPC: ${type}`);
  });
  const startSessionEngine = vi.fn(async ({ sessionPath }: { sessionPath?: string }) => {
    engines = [...engines, { id: "engine-two", sessionPath: sessionPath!, state: "idle" }];
    return engines;
  });
  const stopSessionEngine = vi.fn(async (path: string) => { engines = engines.filter((entry) => entry.sessionPath !== path); return engines; });
  vi.stubGlobal("desktop", { ...offPlanBridge, setZoomFactor() {}, preferences: async () => ({ executable: "omp.exe", cwd: selected.cwd }),
    listSessions: async () => sessions, listSessionEngines: async () => engines, openSession, start, request, startSessionEngine, stopSessionEngine,
    onFrame: (listener: (frame: RpcFrame) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  });
  await render(<App />);
  const emit = async (frame: RpcFrame) => { await act(async () => { for (const listener of listeners) listener(frame); }); };
  return { sessions, openSession, start, emit, startSessionEngine, stopSessionEngine };
}

it("忙时仍可切换，返回运行会话复用快照和流，隔离后台帧及状态灯", async () => {
  const { sessions, openSession, start, emit } = await mount();
  await click(container.querySelectorAll<HTMLButtonElement>(".session-item")[0]);
  expect(container.textContent).toContain("正在生成 one");
  expect(container.querySelector('[aria-label="omp 正在工作"]')).not.toBeNull();
  const second = [...container.querySelectorAll<HTMLButtonElement>(".session-item")].find((button) => button.textContent?.includes("会话 two"))!;
  expect(second.disabled).toBe(false);
  await click(second);
  expect(container.textContent).toContain("历史 two");
  await emit({ type: "message_start", engineId: "engine-one", message: { role: "assistant", content: "不应进入 two" } });
  expect(container.textContent).not.toContain("不应进入 two");
  await emit({ type: "session_engines", engines: [{ id: "engine-one", sessionPath: sessions[0].path, state: "unread" }] });
  expect(container.querySelector('[aria-label="omp 有未读回答"]')).not.toBeNull();
  await click([...container.querySelectorAll<HTMLButtonElement>(".session-item")].find((button) => button.textContent?.includes("会话 one"))!);
  expect(openSession).toHaveBeenLastCalledWith(sessions[0].path);
  expect(start).not.toHaveBeenCalled();
  expect(container.textContent).toContain("正在生成 one");
  await emit({ type: "session_engines", engines: [] });
  expect(container.querySelector(".session-engine-light")).toBeNull();
});

it("后台菜单开启和关闭只命中目标，不切走当前聊天", async () => {
  const { sessions, openSession, startSessionEngine, stopSessionEngine } = await mount();
  await click(container.querySelectorAll<HTMLButtonElement>(".session-item")[0]);
  const target = [...container.querySelectorAll<HTMLButtonElement>(".session-item")].find((button) => button.textContent?.includes("会话 two"))!;
  await act(async () => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
  await click([...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "开启 omp")!);
  expect(startSessionEngine).toHaveBeenCalledWith(expect.objectContaining({ sessionPath: sessions[1].path }));
  expect(openSession).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("正在生成 one");
  await act(async () => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
  expect([...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "开启 omp")!.disabled).toBe(true);
  await click([...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent?.trim() === "关闭 omp")!);
  expect(stopSessionEngine).toHaveBeenCalledExactlyOnceWith(sessions[1].path);
  expect(openSession).toHaveBeenCalledTimes(1);
});
