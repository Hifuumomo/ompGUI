import { offPlanBridge } from "./plan-test-fixture";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopBridge,
  LaunchOptions,
  RpcFrame,
} from "../../shared/protocol";
import App from "./App";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

let container: HTMLDivElement;
let root: Root;
let initialPreferences: Deferred<
  Awaited<ReturnType<DesktopBridge["preferences"]>>
>;
let listeners: Set<(frame: RpcFrame) => void>;
let previousBridge: PropertyDescriptor | undefined;
let previousActEnvironment: PropertyDescriptor | undefined;

const savedPreferences: LaunchOptions = {
  executable: "D:\\omp\\omp.exe",
  cwd: "D:\\workspace",
  profile: "local",
  agentDir: "D:\\omp\\agent",
};

/** 创建可显式完成的异步边界。参数：无。 @returns 尚未完成的 Promise 及其完成、拒绝入口。 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  /** 保存 Promise 完成入口。 @param resolvePromise [in] 成功入口。 @param rejectPromise [in] 失败入口。 @returns 返回值：无。 */
  function capture(
    resolvePromise: (value: T | PromiseLike<T>) => void,
    rejectPromise: (reason?: unknown) => void,
  ) {
    resolve = resolvePromise;
    reject = rejectPromise;
  }
  const promise = new Promise<T>(capture);
  return { promise, resolve, reject };
}

/** 为真实 App 创建独立的原生边界与挂载点。参数：无。 @returns 返回值：无。 */
function prepareConsumer() {
  previousBridge = Object.getOwnPropertyDescriptor(window, "desktop");
  previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  initialPreferences = deferred<LaunchOptions>();
  listeners = new Set();

  /** 提供尚未完成的启动配置读取。参数：无。 @returns 启动配置 Promise。 */
  function preferences() {
    return initialPreferences.promise;
  }
  /** 提供空的本机会话目录，不启动引擎。 @param _agentDir [in] 原生配置目录，可省略。 @returns 空会话目录。 */
  async function listSessions(_agentDir?: string) {
    return [];
  }
  /** 注册真实 App 的原生事件消费者。 @param listener [in] 接收原生帧的回调。 @returns 取消订阅函数。 */
  function onFrame(listener: (frame: RpcFrame) => void) {
    listeners.add(listener);
    /** 移除当前原生事件消费者。参数：无。 @returns 返回值：无。 */
    function unsubscribe() {
      listeners.delete(listener);
    }
    return unsubscribe;
  }
  const prepareModels = vi.fn(async () => ({
    model: { id: "default", name: "默认模型", provider: "test" },
    thinkingLevel: "medium",
  }));
  const bridge = {
    ...offPlanBridge,
    setZoomFactor: () => {},
    preferences,
    listSessions,
    onFrame,
    prepareModels,
  } satisfies Pick<
    DesktopBridge,
    "setZoomFactor" | "preferences" | "listSessions" | "onFrame" | "prepareModels"
  >;
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: bridge,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    writable: true,
    value: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** 恢复挂载前的全局属性。 @param target [in,out] 属性所属对象。 @param key [in] 属性名。 @param descriptor [in] 原始描述符；未定义表示原先不存在。 @returns 返回值：无。 */
function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

/** 卸载真实 App 并清理监听、DOM 与全局桥接。参数：无。 @returns 清理完成的 Promise。 */
async function cleanConsumer() {
  /** 卸载 App，使其移除原生帧与键盘监听。参数：无。 @returns 返回值：无。 */
  function unmount() {
    root.unmount();
  }
  await act(unmount);
  listeners.clear();
  container.remove();
  restoreProperty(window, "desktop", previousBridge);
  restoreProperty(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
    previousActEnvironment,
  );
}

/** 挂载真实 App，保留尚未完成的配置读取。参数：无。 @returns 渲染完成的 Promise。 */
async function renderApp() {
  /** 提交真实 App。参数：无。 @returns 返回值：无。 */
  function commit() {
    root.render(<App />);
  }
  await act(commit);
}

/** 根据可访问名称点击真实按钮。 @param name [in] 按钮名称的语义匹配式。 @param scope [in] 查找范围，默认整个 App。 @returns 点击处理完成的 Promise。 */
async function clickButton(name: RegExp, scope: ParentNode = container) {
  /** 匹配按钮对用户显示的名称。 @param button [in] 候选按钮。 @returns 是否匹配目标名称。 */
  function matches(button: HTMLButtonElement) {
    return name.test(
      button.getAttribute("aria-label") ?? button.textContent ?? "",
    );
  }
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    matches,
  );
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);
  /** 发出真实点击事件。参数：无。 @returns 返回值：无。 */
  function click() {
    button!.click();
  }
  await act(click);
}

/** 根据可见标签取得配置输入框。 @param dialog [in] 配置对话框。 @param name [in] 标签名称匹配式。 @returns 可编辑的输入框。 */
function labeledInput(dialog: HTMLElement, name: RegExp) {
  /** 匹配输入框关联标签。 @param label [in] 候选标签。 @returns 是否匹配目标名称。 */
  function matches(label: HTMLLabelElement) {
    return name.test(label.textContent ?? "");
  }
  const label = [...dialog.querySelectorAll("label")].find(matches);
  const input = label?.querySelector("input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input!.disabled).toBe(false);
  return input!;
}

/** 观察真实设置窗口及其本机连接配置，而非仅检测空弹窗。参数：无。 @returns 设置对话框。 */
function configurationDialog() {
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  labeledInput(dialog!, /可执行文件/);
  labeledInput(dialog!, /工作目录/);
  labeledInput(dialog!, /profile/i);
  labeledInput(dialog!, /agent.*目录/i);
  return dialog!;
}

/** 完成启动配置读取并让 React 处理其异步更新。参数：无。 @returns 更新完成的 Promise。 */
async function completePreferences() {
  /** 完成原生读取。参数：无。 @returns 配置完成的 Promise。 */
  async function complete() {
    initialPreferences.resolve(savedPreferences);
    await initialPreferences.promise;
  }
  await act(complete);
}

/** 将原生状态或错误帧交给 App 的真实订阅者。 @param frame [in] 原生事件帧。 @returns 更新完成的 Promise。 */
async function emitFrame(frame: RpcFrame) {
  /** 向所有已注册消费者分发帧。参数：无。 @returns 返回值：无。 */
  function emit() {
    for (const listener of listeners) listener(frame);
  }
  await act(emit);
}

beforeEach(prepareConsumer);
afterEach(cleanConsumer);

/** 注册启动及设置弹窗的消费者可见回归边界。参数：无。 @returns 返回值：无。 */
function startupSettingsBoundaries() {
  /** 确保首屏及异步配置加载完成均不会强制弹窗。参数：无。 @returns 测试完成的 Promise。 */
  async function startupStaysUnobstructed() {
    await renderApp();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".connection-banner")).toBeNull();
    await completePreferences();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".connection-banner")).toBeNull();
    expect(container.querySelector(".connection-label")).toBeNull();
    await clickButton(/设置/);
    configurationDialog();
  }
  it(
    "首屏及延迟配置加载完成后均不自动弹窗，用户仍可主动打开设置",
    startupStaysUnobstructed,
  );

  /** 验证关闭后晚到配置、状态与错误不会重开窗口，错误仍由现有提示和手动设置显示。参数：无。 @returns 测试完成的 Promise。 */
  async function closedSettingsStayClosed() {
    await renderApp();
    await clickButton(/设置/);
    configurationDialog();
    /** 使用窗口实际监听的 Escape 事件关闭设置。参数：无。 @returns 返回值：无。 */
    function escape() {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    }
    await act(escape);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await completePreferences();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const statusError = "本机引擎连接已中断";
    await emitFrame({
      type: "desktop_status",
      status: "error",
      error: statusError,
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await clickButton(/设置/);
    const dialog = configurationDialog();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      statusError,
    );
    await clickButton(/关闭/, dialog);
    const frameError = "原生事件处理失败";
    await emitFrame({ type: "rpc_frame_error", message: frameError });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      frameError,
    );
    await clickButton(/设置/);
    const reopened = configurationDialog();
    expect(reopened.querySelector('[role="alert"]')?.textContent).toContain(
      frameError,
    );
  }
  it(
    "Escape 和关闭按钮关闭设置后，晚到配置、连接错误与原生错误均不重开，只能主动重开",
    closedSettingsStayClosed,
  );

  /** 验证晚到配置读取失败显示于现有提示，不自动弹窗，手动设置仍可显示错误并编辑。参数：无。 @returns 测试完成的 Promise。 */
  async function failedPreferencesKeepSettingsUsable() {
    await renderApp();
    await clickButton(/设置/);
    await clickButton(/关闭/, configurationDialog());
    const failure = "无法读取本机连接配置";
    /** 拒绝尚未完成的原生配置读取。参数：无。 @returns 返回值：无。 */
    function failPreferences() {
      initialPreferences.reject(new Error(failure));
    }
    await act(failPreferences);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      failure,
    );
    await clickButton(/设置/);
    const dialog = configurationDialog();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      failure,
    );
    const executable = labeledInput(dialog, /可执行文件/);
    const cwd = labeledInput(dialog, /工作目录/);
    // 通过浏览器输入事件填写必需字段，确认失败后用户仍能配置手动连接。
    /** 输入用户手动指定的连接路径。参数：无。 @returns 返回值：无。 */
    function enterPaths() {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(executable, "D:\\manual\\omp.exe");
      executable.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(cwd, "D:\\manual\\project");
      cwd.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await act(enterPaths);
    expect(
      dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(false);
  }
  it(
    "关闭后的配置读取失败不会强制弹窗，并且用户仍能主动打开设置填写连接配置",
    failedPreferencesKeepSettingsUsable,
  );
}

describe("App 启动与手动连接设置", startupSettingsBoundaries);

async function enterPrompt(text: string) {
  await act(() => {
    const input = container.querySelector<HTMLTextAreaElement>(
      ".composer-box textarea",
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("启动准备独立模型进程且排除旧会话路径，提交后才启动聊天进程", async () => {
  const start = vi.fn(async (options: LaunchOptions) => ({
    executable: options.executable,
    cwd: options.cwd,
    protocolVersion: 2,
  }));
  const request = vi.fn(async ({ type }: { type: string }) => {
    switch (type) {
      case "get_state":
        return {
          sessionId: "auto",
          isStreaming: false,
          isCompacting: false,
          isSettled: true,
          messageCount: 0,
          queuedMessageCount: 0,
        };
      case "get_entries":
        return { entries: [], leafId: null };
      case "get_btw_history":
        return { records: [] };
      case "get_available_commands":
        return { commands: [] };
      case "prompt":
        return {};
      default:
        throw new Error(`意外请求：${type}`);
    }
  });
  Object.assign(window.desktop, { start, request });
  await renderApp();
  expect(start).not.toHaveBeenCalled();
  await act(async () => {
    initialPreferences.resolve({
      ...savedPreferences,
      autoConnect: true,
      sessionPath: "old-session.jsonl",
    });
  });
  expect(start).not.toHaveBeenCalled();
  expect(container.querySelector(".connection-banner")).toBeNull();
  expect(window.desktop.prepareModels).toHaveBeenCalledExactlyOnceWith(
    { ...savedPreferences, sessionPath: undefined },
    undefined,
  );
  expect(
    container.querySelector<HTMLButtonElement>(".model-button")?.disabled,
  ).toBe(false);
  expect(container.querySelector(".model-button")?.textContent).toContain(
    "默认模型",
  );
  expect(container.textContent).not.toContain("连接本机引擎");
  await enterPrompt("新任务");
  expect(start).not.toHaveBeenCalled();
  await clickButton(/^发送/);
  expect(start).toHaveBeenCalledExactlyOnceWith({
    ...savedPreferences,
    sessionPath: undefined,
  });
  expect(request).toHaveBeenCalledWith({ type: "prompt", message: "新任务" });
  expect(container.querySelector(".connection-label")).toBeNull();
  expect(container.querySelector(".connection-banner")).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("提交时连接失败保留草稿，关闭错误弹窗后可打开设置修改路径", async () => {
  const start = vi.fn(async () => {
    for (const listener of listeners)
      listener({
        type: "desktop_status",
        status: "error",
        error: "omp 路径不可用",
      });
    throw new Error("omp 路径不可用");
  });
  Object.assign(window.desktop, { start });
  await renderApp();
  expect(start).not.toHaveBeenCalled();
  await act(async () =>
    initialPreferences.resolve({ ...savedPreferences, autoConnect: true }),
  );
  expect(start).not.toHaveBeenCalled();
  await enterPrompt("失败后保留此草稿");
  await clickButton(/^发送/);
  expect(start).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    "omp 路径不可用",
  );
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")
      ?.value,
  ).toBe("失败后保留此草稿");
  await clickButton(/关闭/, container.querySelector('[role="dialog"]')!);
  await clickButton(/设置/);
  const dialog = configurationDialog();
  expect(labeledInput(dialog, /可执行文件/).value).toBe(
    savedPreferences.executable,
  );
  expect(
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
  ).toBe(false);
});

it("没有历史连接配置时只加载设置，不启动引擎", async () => {
  const start = vi.fn();
  Object.assign(window.desktop, { start });
  await renderApp();
  await completePreferences();
  expect(start).not.toHaveBeenCalled();
});
