import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcCommand, RpcFrame } from "../../shared/protocol";
import App from "./App";
import { container, render } from "./transcript-test-harness";

const COMMAND = "inspect";
const ENTRY = {
  id: "user",
  parentId: null,
  timestamp: "2026-10-15",
  type: "message",
  message: { role: "user", content: "已有问题" },
};

const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
beforeEach(() =>
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function responses(): Record<string, unknown> {
  return {
    get_state: { sessionId: "commands", isSettled: true },
    get_entries: { entries: [ENTRY], leafId: ENTRY.id },
    get_tree: {
      tree: [{ entry: ENTRY, children: [] }],
      leafId: ENTRY.id,
    },
    get_btw_history: { records: [] },
    prompt: { agentInvoked: false },
    get_available_commands: { commands: [{ name: "shake" }] },
  };
}

function boundary() {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const known = responses();
  const request = vi.fn(async ({ type }: RpcCommand) => {
    if (!Object.hasOwn(known, type)) throw new Error(`意外 RPC：${type}`);
    return known[type];
  });
  const start = vi.fn(async () => {
    throw new Error("命令候选不应启动会话");
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
    listSessions: async () => [],
    request,
    start,
    ...offPlanBridge,
    onFrame: (listener: (frame: RpcFrame) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const emit = (frame: RpcFrame) =>
    listeners.forEach((listener) => listener(frame));
  return { request, start, emit };
}

async function mount(connected = true) {
  const api = boundary();
  await render(<App />);
  await act(async () => {
    api.emit({
      type: "available_commands_update",
      commands: [{ name: COMMAND, aliases: ["i"], description: "检查命令" }],
    });
    if (connected) {
      api.emit({ type: "desktop_status", status: "connected" });
      api.emit({ type: "session_info_update" });
    }
  });
  return api;
}

function composer() {
  return container.querySelector<HTMLTextAreaElement>(
    ".composer-box textarea",
  )!;
}

async function input(value: string) {
  await act(async () => {
    const textarea = composer();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(options: KeyboardEventInit = {}) {
  await act(async () => {
    composer().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

async function selectCommand(
  source: "suggestions" | "catalogue",
  name: string,
) {
  if (source === "suggestions") await input(`/${name.slice(0, 2)}`);
  else
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="查看全部命令"]')!
        .click();
    });
  const selector = source === "suggestions" ? ".slash-menu" : ".command-list";
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>(`${selector} button`),
  ].find(
    (candidate) =>
      candidate.querySelector("strong")?.textContent === `/${name}`,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

function prompts(api: ReturnType<typeof boundary>) {
  return api.request.mock.calls.filter(
    ([command]) => command.type === "prompt",
  );
}

it("已选会话中按斜杠聚焦提示词并输入，不抢其他输入框", async () => {
  await mount();
  await act(async () => {
    composer().blur();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(composer());
  expect(composer().value).toBe("/");
  const search = container.querySelector<HTMLInputElement>(
    ".sidebar-search input",
  )!;
  await act(async () => {
    search.focus();
    search.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(search);
  expect(composer().value).toBe("/");
});

it("未选会话时斜杠不触发全局输入", async () => {
  await mount(false);
  await act(async () => {
    composer().blur();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(composer().value).toBe("");
  expect(document.activeElement).not.toBe(composer());
});

it("命令候选默认首项高亮，方向键移动，查询变化重置并执行所选命令", async () => {
  await mount();
  const selected = () =>
    container.querySelector('.slash-menu [aria-selected="true"] strong')
      ?.textContent;
  const down = async () =>
    act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await input("/");
  const initialCandidates = [
    ...container.querySelectorAll(".slash-menu strong"),
  ].map((node) => node.textContent);
  expect(initialCandidates.length).toBeGreaterThan(1);
  expect(selected()).toBe(initialCandidates[0]);
  await down();
  expect(selected()).toBe(initialCandidates[1]);
  await input("/re");
  const filteredCandidates = [
    ...container.querySelectorAll(".slash-menu strong"),
  ].map((node) => node.textContent);
  expect(selected()).toBe(filteredCandidates[0]);
  const rewindIndex = filteredCandidates.indexOf("/rewind");
  expect(rewindIndex).toBeGreaterThanOrEqual(0);
  for (let index = 0; index < rewindIndex; index++) await down();
  expect(selected()).toBe("/rewind");
  expect(
    container.querySelectorAll('.slash-menu [aria-selected="true"]'),
  ).toHaveLength(1);
  await enter();
  expect(container.querySelector(".rewind-transcript")).not.toBeNull();
});

it.each(["suggestions", "catalogue"] as const)(
  "已连接时从 %s 激活命令直接执行一次，并消费草稿",
  async (source) => {
    const api = await mount();
    await selectCommand(source, COMMAND);
    expect(prompts(api)).toEqual([
      [{ type: "prompt", message: `/${COMMAND} ` }],
    ]);
    expect(composer().value).toBe("");
    expect(container.querySelector(".command-list")).toBeNull();
    expect(api.start).not.toHaveBeenCalled();
  },
);

it.each(["suggestions", "catalogue"] as const)(
  "已连接时从 %s 激活 /tree 直接打开会话树",
  async (source) => {
    const api = await mount();
    await selectCommand(source, "tree");
    expect(container.querySelector(".native-tree-screen")).not.toBeNull();
    expect(api.request).not.toHaveBeenCalledWith({ type: "get_tree" });
    expect(prompts(api)).toHaveLength(0);
    expect(composer().value).toBe("");
  },
);

it.each(["suggestions", "catalogue"] as const)(
  "从 %s 执行失败保留所选命令并显示原生错误",
  async (source) => {
    const api = await mount();
    api.request.mockRejectedValueOnce(new Error("原生命令执行失败"));
    await selectCommand(source, COMMAND);
    expect(prompts(api)).toHaveLength(1);
    expect(composer().value).toBe(`/${COMMAND} `);
    expect(container.textContent).toContain("原生命令执行失败");
  },
);

it.each(["suggestions", "catalogue"] as const)(
  "未连接时从 %s 选择命令只补全，不发送或连接",
  async (source) => {
    const api = await mount(false);
    await selectCommand(source, COMMAND);
    expect(composer().value).toBe(`/${COMMAND} `);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  },
);

it.each(["/inspect --scope project 详细说明", "/i --scope project"])(
  "文本框一次 Enter 原样发送完整命令和参数：%s",
  async (command) => {
    const api = await mount();
    await input(command);
    await enter();
    expect(prompts(api)).toEqual([[{ type: "prompt", message: command }]]);
    expect(composer().value).toBe("");
  },
);

it.each([{ isComposing: true }, { shiftKey: true }])(
  "输入法或换行 Enter 保留草稿且不执行：%o",
  async (options) => {
    const api = await mount();
    await input(`/${COMMAND}`);
    await enter(options);
    expect(prompts(api)).toHaveLength(0);
    expect(composer().value).toBe(`/${COMMAND}`);
  },
);

it("完整 /tree 输入无需经过候选，按一次 Enter 打开会话树", async () => {
  const api = await mount();
  await input("/tree");
  await enter();
  expect(container.querySelector(".native-tree-screen")).not.toBeNull();
  expect(prompts(api)).toHaveLength(0);
});

it.each(["suggestions", "catalogue", "composer"] as const)(
  "从 %s 执行 /rewind 进入与双 Esc 相同的回退目标，不调用模型",
  async (source) => {
    const api = await mount();
    if (source === "composer") {
      await input("/rewind");
      await enter();
    } else await selectCommand(source, "rewind");
    expect(
      container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
    ).toBe(ENTRY.id);
    expect(api.request).toHaveBeenCalledWith({ type: "get_entries" });
    expect(api.request).not.toHaveBeenCalledWith({ type: "get_tree" });
    expect(prompts(api)).toHaveLength(0);
    expect(api.start).not.toHaveBeenCalled();
    expect(composer().value).toBe("");
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(container.querySelector(".rewind-transcript")).toBeNull();
    for (let index = 0; index < 2; index++)
      await act(async () =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      );
    expect(
      container.querySelector(".rewind-target")?.getAttribute("data-rewind-id"),
    ).toBe(ENTRY.id);
  },
);

it("未连接时 /rewind 提示连接并保留草稿，不启动引擎", async () => {
  const api = await mount(false);
  await input("/rewind");
  await enter();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    "连接具体会话 omp 后才能使用此功能",
  );
  expect(composer().value.trim()).toBe("/rewind");
  expect(api.request).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

it("会话忙时 /rewind 保留命令并提示等待空闲", async () => {
  const api = await mount();
  await act(async () => api.emit({ type: "agent_start" }));
  api.request.mockClear();
  await input("/rewind");
  await enter();
  expect(container.textContent).toContain("请先停止当前工作并等待会话空闲");
  expect(container.querySelector(".rewind-transcript")).toBeNull();
  expect(composer().value.trim()).toBe("/rewind");
  expect(api.request).not.toHaveBeenCalled();
});

it("回退历史读取失败保留命令并显示原生错误", async () => {
  const api = await mount();
  api.request.mockRejectedValueOnce(new Error("回退历史读取失败"));
  await input("/rewind");
  await enter();
  expect(container.textContent).toContain("回退历史读取失败");
  expect(container.querySelector(".rewind-transcript")).toBeNull();
  expect(composer().value.trim()).toBe("/rewind");
  expect(prompts(api)).toHaveLength(0);
});

it("/jobs 侧栏按任务分卡片，单独折叠展开并分区显示命令，刷新保留展开状态", async () => {
  const api = await mount();
  const pane = () => container.querySelector('[aria-label="后台任务"]')!;
  const summary = (id: string) =>
    [...pane().querySelectorAll<HTMLButtonElement>(".job-summary")].find(
      (button) => button.querySelector(".job-id")?.textContent === id,
    )!;
  const output = [
    "Background Jobs",
    "Running: 2",
    "",
    "```text",
    "\u001b[32m[bg_1] bash (running) — 14s\u001b[39m",
    "  sleep 200",
    "[bg_2] bash (running) — 9s",
    "  npm run build",
    "```",
  ].join("\n");
  api.request.mockResolvedValueOnce({ agentInvoked: false, output });
  await input("/jobs full");
  await enter();
  expect(prompts(api)).toEqual([[{ type: "prompt", message: "/jobs full" }]]);
  expect(composer().value).toBe("");
  expect(pane().textContent).not.toContain("原生 /jobs 输出");
  expect(pane().querySelector(".jobs-count")?.textContent).toBe("运行中 2");
  expect(pane().textContent).not.toContain("```");
  expect(pane().querySelectorAll(".job-command")).toHaveLength(0);
  await act(async () => summary("bg_1").click());
  expect(summary("bg_1").getAttribute("aria-expanded")).toBe("true");
  expect(summary("bg_2").getAttribute("aria-expanded")).toBe("false");
  expect(
    [...pane().querySelectorAll(".job-command")].map((node) => node.textContent),
  ).toEqual(["sleep 200"]);
  api.request.mockResolvedValueOnce({ agentInvoked: false, output });
  await act(async () =>
    [...pane().querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "刷新")!
      .click(),
  );
  expect(prompts(api).at(-1)).toEqual([{ type: "prompt", message: "/jobs" }]);
  expect(summary("bg_1").getAttribute("aria-expanded")).toBe("true");
  await act(async () => summary("bg_1").click());
  expect(pane().querySelectorAll(".job-command")).toHaveLength(0);
});

it("展开任务显示按 jobId 归属的后台输出：纯文本、去除控制序列、快照替换", async () => {
  const api = await mount();
  const pane = () => container.querySelector('[aria-label="后台任务"]')!;
  const summary = (id: string) =>
    [...pane().querySelectorAll<HTMLButtonElement>(".job-summary")].find(
      (button) => button.querySelector(".job-id")?.textContent === id,
    )!;
  const update = (text: string) =>
    act(async () =>
      api.emit({
        type: "tool_execution_update",
        toolCallId: "call-1",
        toolName: "bash",
        partialResult: {
          content: [{ type: "text", text }],
          details: { async: { state: "running", jobId: "bg_1", type: "bash" } },
        },
      }),
    );
  api.request.mockResolvedValueOnce({
    agentInvoked: false,
    output: [
      "Background Jobs",
      "Running: 2",
      "",
      "```text",
      "[bg_1] bash (running) — 3s",
      "  ./watch.sh",
      "[bg_2] bash (running) — 2s",
      "  sleep 200",
      "```",
    ].join("\n"),
  });
  await input("/jobs");
  await enter();
  await update("\u001b[31mtick 1\u001b[39m\n<b>tick 2</b>\n");
  expect(pane().querySelectorAll(".job-output")).toHaveLength(0);
  await act(async () => summary("bg_1").click());
  const output = () => pane().querySelector(".job-output");
  expect(output()?.textContent).toBe("tick 1\n<b>tick 2</b>");
  expect(output()?.querySelector("b")).toBeNull();
  await update("tick 1\ntick 2\ntick 3\n");
  expect(output()?.textContent).toBe("tick 1\ntick 2\ntick 3");
  await act(async () => summary("bg_2").click());
  expect(pane().querySelector(".job-output-empty")).not.toBeNull();
});

it("/shake 在确认前不改写历史，取消不发送原生命令", async () => {
  const api = await mount();
  await input("/shake thinking");
  await enter();
  expect(prompts(api)).toEqual([]);
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("改写");
  const cancel = [...dialog.querySelectorAll("button")].find(button => button.textContent === "取消")!;
  await act(async () => cancel.click());
  expect(prompts(api)).toEqual([]);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("/shake 确认后执行并刷新历史，旧引擎不支持时不发送模型提示词", async () => {
  const api = await mount();
  await input("/shake thinking");
  await enter();
  await act(async () => {
    [...container.querySelectorAll("button")].find(button => button.textContent === "确认改写历史")!.click();
  });
  expect(prompts(api)).toEqual([[{ type: "prompt", message: "/shake thinking" }]]);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  api.request.mockImplementation(async ({ type }: RpcCommand) =>
    type === "get_available_commands" ? { commands: [] } : responses()[type],
  );
  await input("/shake images");
  await enter();
  await act(async () => {
    [...container.querySelectorAll("button")].find(button => button.textContent === "确认改写历史")!.click();
  });
  expect(prompts(api)).toHaveLength(1);
  expect(container.textContent).toContain("当前 omp 未提供 /shake");
});

it("未连接时 /seance 打开来源选择而不启动引擎或把命令发给模型", async () => {
  const api = await mount(false);
  await input("/seance");
  await enter();
  expect(container.querySelector('[aria-label="Seance 源会话"]')).not.toBeNull();
  expect(api.start).not.toHaveBeenCalled();
  expect(prompts(api)).toEqual([]);
});
