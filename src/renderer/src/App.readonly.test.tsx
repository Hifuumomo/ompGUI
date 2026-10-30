import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { hubSnapshot } from "./model-hub-test-fixture";
import type { NativeModelAction } from "../../shared/native-model";
import { setup, cleanup, render, container } from "./transcript-test-harness";
import type {
  ReadOnlySession,
  RpcFrame,
  LaunchOptions,
  ModelSelection,
} from "../../shared/protocol";

let previous: PropertyDescriptor | undefined;
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
  if (previous) Object.defineProperty(window, "desktop", previous);
  else Reflect.deleteProperty(window, "desktop");
});

it.each([
  "SESSION_OCCUPIED：该会话正在被其他 omp 实例使用",
  "所选模型在当前工作目录不可用",
])(
  "提前选模型、只读浏览、失败保留草稿与选择、重试只发送一次：%s",
  /** 验证只读回顾隔离与连接重试行为。[in] failure：首次连接失败提示。返回值：断言完成的 Promise。 */
  async (failure) => {
    setup();
    vi.useFakeTimers();
    previous = Object.getOwnPropertyDescriptor(window, "desktop");
    const summary = {
      path: "D:/sessions/one.jsonl",
      id: "one",
      cwd: "D:/workspace",
      title: "监控测试会话",
      timestamp: "2026-10-14",
      modified: 1,
      recap: {
        text: "## 已完成\n\n这是 **完整内容**。\n\n回顾末尾",
        createdAt: 1792368000,
      },
    };
    let snapshot: ReadOnlySession = {
      summary,
      messages: [{ role: "user", content: "已有内容" }],
    };
    const withoutRecap: ReadOnlySession = {
      summary: {
        ...summary,
        id: "two",
        path: "D:/sessions/two.jsonl",
        title: "无回顾会话",
        recap: undefined,
      },
      messages: [{ role: "user", content: "另一个会话" }],
    };
    const listeners = new Set<(frame: RpcFrame) => void>();
    const choices = [
      { provider: "test", id: "one", name: "模型一" },
      { provider: "test", id: "two", name: "模型二" },
    ];
    let modelState = { model: choices[0], thinkingLevel: "medium" };
    const prepareModels = vi.fn(async () => modelState);
    const modelRequest = vi.fn(
      async (command: {
        type: string;
        modelId?: string;
        direction?: string;
        action?: NativeModelAction;
      }) => {
        if (command.type === "get_available_models") return { models: choices };
        if (command.type === "model_hub") {
          const action = command.action;
          if (action?.op === "temporary" && action.target === "session")
            modelState = { ...modelState, model: choices.find((model) => `${model.provider}/${model.id}` === action.selector)! };
          return {
            ...hubSnapshot,
            models: choices.map((model) => ({ ...model, selector: `${model.provider}/${model.id}`, kind: "chat", thinkingLevels: ["medium", "high"], allowedRoles: ["default"] })),
            currentSelector: `${modelState.model.provider}/${modelState.model.id}`,
          };
        }
        if (command.type === "get_available_thinking_levels")
          return { levels: ["medium", "high"] };
        if (command.type === "set_model")
          modelState = {
            ...modelState,
            model: choices.find((model) => model.id === command.modelId)!,
          };
        if (command.type === "cycle_role_model") {
          modelState = { ...modelState, model: choices[0] };
          return {
            ...modelState,
            order: ["smol", "default", "slow"],
            role: command.direction === "backward" ? "slow" : "smol",
          };
        }
        return modelState;
      },
    );
    const start = vi.fn(
      async (options: LaunchOptions, _selection?: ModelSelection) => ({
        ...options,
        protocolVersion: 2,
      }),
    );
    start.mockRejectedValueOnce(new Error(failure));
    let selectedPath = summary.path;
    const openSession = vi.fn(
      /** 按路径返回独立只读快照。[in] path：所选会话文件路径。返回值：匹配的会话快照。 */
      async (path: string) => {
        selectedPath = path;
        return { snapshot: path === withoutRecap.summary.path ? withoutRecap : snapshot };
      },
    );
    const readSession = vi.fn(async () =>
      selectedPath === withoutRecap.summary.path ? withoutRecap : snapshot,
    );
    const request = vi.fn(async ({ type }: { type: string }) => {
      if (type === "get_state")
        return {
          ...modelState,
          sessionId: summary.id,
          sessionFile: summary.path,
          isStreaming: false,
          isCompacting: false,
          isSettled: true,
          messageCount: snapshot.messages.length,
          queuedMessageCount: 0,
        };
      if (type === "get_entries")
        return {
          entries: snapshot.messages.map((message, i) => ({
            type: "message",
            id: `m${i}`,
            parentId: i ? `m${i - 1}` : null,
            message,
          })),
          leafId: `m${snapshot.messages.length - 1}`,
        };
      if (type === "get_btw_history") return { records: [] };
      if (type === "get_available_commands") return { commands: [] };
      if (type === "prompt") return {};
      throw new Error(`不应调用：${type}`);
    });
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        setZoomFactor: () => {},
        preferences: async () => ({
          executable: "omp.exe",
          cwd: summary.cwd,
          autoConnect: true,
        }),
        /** 返回包含有回顾和无回顾会话的目录。参数：无。返回值：原生摘要列表。 */
        listSessions: async () => [summary, withoutRecap.summary],
        start,
        prepareModels,
        modelRequest,
        openSession,
        readSession,
        request,
        ...offPlanBridge,
        onFrame: (listener: (frame: RpcFrame) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    await render(<App />);
    expect(prepareModels).toHaveBeenCalledTimes(1);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".model-button")!.click(),
    );
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>(".model-hub-model")[1].click(),
    );
    expect(container.querySelector(".model-button")?.textContent).toContain(
      "模型二",
    );
    expect(start).not.toHaveBeenCalled();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".session-item")!.click(),
    );
    expect(openSession).toHaveBeenCalledExactlyOnceWith(summary.path);
    expect(start).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const recapPanel = container.querySelector<HTMLElement>(".session-recap")!;
    const panelBody = container.querySelector<HTMLElement>(".todo-list")!;
    expect(panelBody.hidden).toBe(true);
    expect(recapPanel.querySelector("time")?.dateTime).toBe(
      new Date(summary.recap.createdAt * 1000).toISOString(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".todo-panel-toggle")!.click(),
    );
    expect(panelBody.hidden).toBe(false);
    expect(recapPanel.querySelector(".rich-content h2")?.textContent).toBe("已完成");
    expect(recapPanel.querySelector(".rich-content strong")?.textContent).toBe("完整内容");
    expect(recapPanel.textContent).toContain("回顾末尾");
    // 切换到缺少原生回顾的会话时必须移除旧面板，返回时重新默认折叠。
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>(".session-item")[1].click(),
    );
    expect(container.querySelector(".session-recap")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".session-item")!.click(),
    );
    expect(container.querySelector<HTMLElement>(".todo-list")?.hidden).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>(".send-button")!.disabled,
    ).toBe(false);
    expect(container.querySelector(".send-button")!.textContent).toBe("连接");
    expect(container.textContent).toContain("已有内容");
    expect(container.querySelector(".connection-banner")).toBeNull();
    expect(container.querySelector(".connection-label")).toBeNull();
    expect(container.querySelector(".model-button")?.textContent).toContain(
      "模型二",
    );
    // 浏览历史时也能循环模型，独立模型操作不触及聊天进程或历史快照。
    prepareModels.mockRejectedValueOnce(new Error("原先模型在此目录不可用"));
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".model-button")!.click(),
    );
    expect(container.querySelector('[aria-label="Switch Model"]')).not.toBeNull();
    expect(container.textContent).toContain("原先模型在此目录不可用");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[role="dialog"] button')!
        .click(),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", ctrlKey: true }),
      ),
    );
    expect(container.querySelector(".model-button")?.textContent).toContain(
      "模型一",
    );
    expect(modelRequest).toHaveBeenCalledWith({
      type: "cycle_role_model",
      direction: "forward",
    });
    expect(
      container.querySelector('.model-cycle-track [aria-current="true"]')
        ?.textContent,
    ).toBe("smol");
    const composerInput = container.querySelector<HTMLTextAreaElement>(
      ".composer-box textarea",
    )!;
    composerInput.focus();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      composerInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "P",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(modelRequest).toHaveBeenCalledWith({
      type: "cycle_role_model",
      direction: "backward",
    });
    expect(container.querySelectorAll(".model-cycle-track")).toHaveLength(1);
    expect(
      container.querySelector('.model-cycle-track [aria-current="true"]')
        ?.textContent,
    ).toBe("slow");
    expect(document.activeElement).toBe(composerInput);
    const callsBeforeRepeat = modelRequest.mock.calls.length;
    await act(async () => {
      composerInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          ctrlKey: true,
          repeat: true,
          bubbles: true,
        }),
      );
    });
    expect(modelRequest.mock.calls).toHaveLength(callsBeforeRepeat);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelector(".model-cycle-track")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.querySelector(".model-cycle-track")).toBeNull();
    const input = container.querySelector<HTMLTextAreaElement>(
      ".composer-box textarea",
    )!;
    expect(input.placeholder).toBe("描述任务，或输入 / 查看命令…");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "继续此任务");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(start).not.toHaveBeenCalled();
    snapshot = {
      summary,
      messages: [
        ...snapshot.messages,
        { role: "assistant", content: "终端新增回复" },
      ],
    };
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(container.textContent).toContain("终端新增回复");
    expect(input.value).toBe("继续此任务");
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".send-button")!.click(),
    );
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      failure,
    );
    expect(input.value).toBe("继续此任务");
    expect(container.textContent).toContain("终端新增回复");
    expect(request).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="重新读取原生会话历史"]',
      )?.disabled,
    ).toBe(true);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[role="dialog"] button')!
        .click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".send-button")!.click(),
    );
    expect(start).toHaveBeenLastCalledWith(
      {
        executable: "omp.exe",
        cwd: summary.cwd,
        sessionPath: summary.path,
      },
      { provider: "test", modelId: "one", thinkingLevel: "medium" },
    );
    expect(container.querySelector(".send-button")!.textContent).toBe("发送 ↑");
    expect(container.querySelector(".session-recap")?.textContent).toContain("回顾末尾");
    expect(input.value).toBe("继续此任务");
    expect(
      request.mock.calls.filter(([command]) => command.type === "prompt"),
    ).toHaveLength(0);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".send-button")!.click(),
    );
    expect(
      request.mock.calls.filter(([command]) => command.type === "prompt"),
    ).toEqual([[{ type: "prompt", message: "继续此任务" }]]);
    expect(input.value).toBe("");
    expect(container.textContent).not.toContain("只读监控：");
  },
);
