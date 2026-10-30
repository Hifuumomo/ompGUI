import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcCommand, RpcFrame, SessionEntry } from "../../shared/protocol";
import App from "./App";
import { container, render } from "./transcript-test-harness";

const entries: SessionEntry[] = [
  {
    id: "question",
    parentId: null,
    type: "message",
    timestamp: "2026-10-15T00:00:00Z",
    message: { role: "user", content: "原始问题" },
  },
  {
    id: "answer",
    parentId: "question",
    type: "message",
    timestamp: "2026-10-15T00:00:01Z",
    message: { role: "assistant", content: "原始回答" },
  },
];
const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function boundary(failure: boolean) {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const request = vi.fn(async (command: RpcCommand) => {
    const data: Record<string, unknown> = {
      get_state: {
        sessionId: "same-session",
        isSettled: true,
        messageCount: entries.length,
      },
      get_entries: { entries, leafId: "answer" },
      get_tree: { tree: [], leafId: "answer" },
      get_btw_history: { records: [] },
    };
    if (!Object.hasOwn(data, command.type))
      throw new Error(`意外 RPC：${command.type}`);
    return data[command.type];
  });
  const navigateTree = vi.fn(async () => {
    if (failure) throw new Error("原生回退失败");
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
    listSessions: async () => [],
    request,
    navigateTree,
    ...offPlanBridge,
    onFrame: (listener: (frame: RpcFrame) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { request, navigateTree, listeners };
}

async function key(key: string) {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

async function mount(failure = false) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  const api = boundary(failure);
  await render(<App />);
  await act(async () => {
    api.listeners.forEach((listener) =>
      listener({ type: "desktop_status", status: "connected" }),
    );
    api.listeners.forEach((listener) =>
      listener({ type: "session_info_update" }),
    );
  });
  await key("Escape");
  await key("Escape");
  return api;
}

it("双 Esc 在正文框选回退点，方向键切换后仅确认才进行同文件导航", async () => {
  const api = await mount();
  container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!.blur();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(
    container
      .querySelector('[aria-current="true"]')
      ?.getAttribute("data-rewind-id"),
  ).toBe("answer");
  await key("ArrowUp");
  expect(
    container
      .querySelector('[aria-current="true"]')
      ?.getAttribute("data-rewind-id"),
  ).toBe("question");
  expect(api.navigateTree).not.toHaveBeenCalled();
  await key("Enter");
  expect(api.navigateTree).toHaveBeenCalledExactlyOnceWith("question");
  expect(container.querySelector(".rewind-transcript")).toBeNull();
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")
      ?.value,
  ).toBe("原始问题");
  expect(document.activeElement).toBe(container.querySelector(".composer-box textarea"));
  expect(
    api.request.mock.calls.every(
      ([command]) => command.type !== "fork_session",
    ),
  ).toBe(true);
});

it.each(["Escape", "button"])("通过 %s 取消回退后恢复提示词焦点且不提交导航", async (exit) => {
  const api = await mount();
  const input = container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
  input.blur();
  if (exit === "Escape") await key("Escape");
  else await act(() => {
    const cancel = container.querySelector<HTMLButtonElement>(".rewind-controls button:last-child")!;
    cancel.focus();
    cancel.click();
  });
  expect(container.querySelector(".rewind-transcript")).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(api.navigateTree).not.toHaveBeenCalled();
});

it("筛选内 Esc 仅退出筛选，再次 Esc 退出回退并聚焦提示词", async () => {
  await mount();
  await key("f");
  expect(document.activeElement).toBe(container.querySelector(".rewind-filter input"));
  await key("Escape");
  expect(container.querySelector(".rewind-transcript")).not.toBeNull();
  expect(document.activeElement).not.toBe(container.querySelector(".composer-box textarea"));
  await key("Escape");
  expect(document.activeElement).toBe(container.querySelector(".composer-box textarea"));
});

it("异步回退完成且输入框解除禁用后才恢复提示词焦点", async () => {
  const api = await mount();
  let finish!: () => void;
  api.navigateTree.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const input = container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
  input.blur();
  await key("Enter");
  expect(input.disabled).toBe(true);
  expect(document.activeElement).not.toBe(input);
  await act(async () => { finish(); });
  expect(input.disabled).toBe(false);
  expect(container.querySelector(".rewind-transcript")).toBeNull();
  expect(document.activeElement).toBe(input);
});

it("退出独立回退界面后恢复正文阅读位置", async () => {
  await mount();
  await key("Escape");
  container.querySelector<HTMLElement>(".transcript")!.scrollTop = 360;
  await key("Escape");
  await key("Escape");
  expect(container.querySelector(".rewind-transcript")).not.toBeNull();
  await key("Escape");
  expect(container.querySelector<HTMLElement>(".transcript")!.scrollTop).toBe(
    360,
  );
});

it("原生回退失败时保留虚线目标并显示实际错误", async () => {
  const api = await mount(true);
  container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!.blur();
  await key("Enter");
  expect(api.navigateTree).toHaveBeenCalledExactlyOnceWith("answer");
  expect(container.querySelector(".rewind-target")).not.toBeNull();
  expect(container.textContent).toContain("原生回退失败");
  expect(document.activeElement).not.toBe(container.querySelector(".composer-box textarea"));
});
