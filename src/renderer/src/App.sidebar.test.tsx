import { offPlanBridge } from "./plan-test-fixture";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BtwRecord,
  ConnectionInfo,
  DesktopBridge,
  LaunchOptions,
  RpcCommand,
  RpcFrame,
  SessionSummary,
  SessionState,
  SlashCommand,
} from "../../shared/protocol";
import App from "./App";
import type { SessionHistorySnapshot } from "../../shared/session-history";

interface Deferred<T> {
  promise: Promise<T>; // 由测试控制完成时机的原生边界。
  resolve: (value: T) => void; // 完成当前原生边界。
}
let container: HTMLDivElement;
let root: Root;
let listeners: Set<(frame: RpcFrame) => void>;
let previousBridge: PropertyDescriptor | undefined;
let previousActEnvironment: PropertyDescriptor | undefined;
let nativeCatalogue: SessionSummary[];
let nativeActive: SessionSummary | undefined;
let resumeCount: number;
let startBoundary: Deferred<void> | undefined;
let historyBoundary: Deferred<void> | undefined;
let catalogueBoundary: Deferred<void> | undefined;

const commonParent = "C:/Users/sidebar/AppData/Local/Temp/catalogue-root";
const alphaCwd = `${commonParent}/alpha/shared/project`;
const betaCwd = `${commonParent}/beta/shared/project`;
const savedPreferences: LaunchOptions = {
  executable: "D:/omp/omp.exe",
  cwd: alphaCwd,
  agentDir: "D:/omp/agent",
};
const catalogue: SessionSummary[] = [
  {
    path: "D:/omp/agent/sessions/alpha-primary.jsonl",
    id: "alpha-primary",
    cwd: alphaCwd,
    title: "Investigate alpha rendering",
    timestamp: "2026-10-01T10:00:00.000Z",
    modified: Date.parse("2026-10-01T10:00:00.000Z"),
  },
  {
    path: "D:/omp/agent/sessions/beta-primary.jsonl",
    id: "beta-primary",
    cwd: betaCwd,
    title: "Review beta catalogue",
    timestamp: "2026-10-01T09:00:00.000Z",
    modified: Date.parse("2026-10-01T09:00:00.000Z"),
  },
  {
    path: "D:/omp/agent/sessions/alpha-followup.jsonl",
    id: "alpha-followup",
    cwd: alphaCwd,
    title: "Continue alpha discussion",
    timestamp: "2026-10-01T08:00:00.000Z",
    modified: Date.parse("2026-10-01T08:00:00.000Z"),
  },
];

const gammaCwd = `${commonParent}/gamma/notes`;
const deltaCwd = `${commonParent}/delta/new-root`;
const gammaSession: SessionSummary = {
  path: "D:/omp/agent/sessions/gamma-primary.jsonl",
  id: "gamma-primary",
  cwd: gammaCwd,
  title: "Organize gamma notes",
  timestamp: "2026-10-01T07:00:00.000Z",
  modified: Date.parse("2026-10-01T07:00:00.000Z"),
};
const deltaSession: SessionSummary = {
  path: "D:/omp/agent/sessions/delta-primary.jsonl",
  id: "delta-primary",
  cwd: deltaCwd,
  title: "Newest native project",
  timestamp: "2026-10-02T12:00:00.000Z",
  modified: Date.parse("2026-10-02T12:00:00.000Z"),
};

/** 创建只控制原生异步完成时机的边界，不替代 App 状态。参数：无。 @returns Promise 及其完成入口。 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  /** 捕获 Promise 完成入口。 @param complete [in] Promise 的成功回调。 @returns 返回值：无。 */
  function capture(complete: (value: T | PromiseLike<T>) => void) {
    resolve = complete;
  }
  return { promise: new Promise<T>(capture), resolve };
}

/** 为真实 App 创建隔离的本机会话目录边界与挂载点。参数：无。 @returns 返回值：无。 */
function prepareConsumer() {
  previousBridge = Object.getOwnPropertyDescriptor(window, "desktop");
  previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  listeners = new Set();
  nativeCatalogue = [...catalogue];
  nativeActive = undefined;
  resumeCount = 0;
  startBoundary = undefined;
  historyBoundary = undefined;
  catalogueBoundary = undefined;
  /** 提供测试目录对应的本机启动配置，不连接引擎。参数：无。 @returns 保存的启动配置。 */
  async function preferences() {
    return savedPreferences;
  }
  /** 提供可由测试更新的完整本机会话目录。 @param _agentDir [in] 原生配置目录，可省略。 @returns 独立的当前目录数组。 */
  async function listSessions(_agentDir?: string) {
    await catalogueBoundary?.promise;
    return [...nativeCatalogue];
  }
  /** 创建隔离的新会话摘要，保留全部已有历史。 */
  function createNativeSession(cwd: string) {
    const id = `new-${nativeCatalogue.length}`;
    nativeActive = {
      id,
      path: `D:/omp/agent/sessions/${id}.jsonl`,
      cwd,
      title: "新会话",
      timestamp: "2026-10-19T00:00:00.000Z",
      modified: deltaSession.modified + nativeCatalogue.length * 1000,
    };
    nativeCatalogue = [nativeActive, ...nativeCatalogue];
  }
  /** 恢复真实目录中的会话并模拟原生文件恢复后的 mtime 与标题更新。 @param options [in] App 提交的启动配置与会话路径。 @returns 原生 header 对应的连接信息。 */
  async function start(options: LaunchOptions): Promise<ConnectionInfo> {
    await startBoundary?.promise;
    if (!options.sessionPath) {
      createNativeSession(options.cwd);
      return { executable: options.executable, cwd: options.cwd, protocolVersion: 2 };
    }
    const session = nativeCatalogue.find(
      /** 按原生文件身份查找被恢复的会话。 @param candidate [in] 当前目录成员。 @returns 是否为启动目标。 */
      (candidate) => candidate.path === options.sessionPath,
    );
    if (!session) throw new Error(`会话不存在：${options.sessionPath}`);
    resumeCount += 1;
    nativeActive = {
      ...session,
      title: `${session.title} · 恢复 ${resumeCount}`,
      modified: deltaSession.modified + resumeCount * 1000,
    };
    // 恢复后的文件已写回，原生目录以该文件为首且允许其他返回顺序变化。
    nativeCatalogue = [
      nativeActive,
      ...nativeCatalogue
        .filter(
          /** 移除旧摘要，避免同一原生路径出现两次。 @param candidate [in] 原生目录成员。 @returns 是否保留为其他会话。 */
          (candidate) => candidate.path !== session.path,
        )
        .reverse(),
    ];
    return {
      executable: options.executable,
      cwd: session.cwd,
      protocolVersion: 2,
    };
  }
  /** 提供 App 实际恢复流程读取的原生快照、历史与命令；未知请求明确失败。 @param command [in] 原生 RPC 命令。 @returns 对应命令的协议载荷。 */
  async function request<T = unknown>(command: RpcCommand): Promise<T> {
    if (!nativeActive) throw new Error("尚未恢复原生会话");
    if (command.type === "new_session") {
      createNativeSession(nativeActive.cwd);
      return {} as T;
    }
    let response:
      | SessionState
      | SessionHistorySnapshot
      | { records: BtwRecord[] }
      | { commands: SlashCommand[] };
    switch (command.type) {
      case "get_state":
        response = {
          sessionId: nativeActive.id,
          sessionFile: nativeActive.path,
          sessionName: nativeActive.title,
          isStreaming: false,
          isCompacting: false,
          isSettled: true,
          messageCount: nativeActive.id.startsWith("new-") ? 0 : 1,
          queuedMessageCount: 0,
        };
        break;
      case "get_entries":
        await historyBoundary?.promise;
        response = {
          entries: nativeActive.id.startsWith("new-") ? [] : [
            {
              type: "message",
              id: "entry",
              parentId: null,
              timestamp: "2026-10-13T00:00:00Z",
              message: {
                role: "user",
                content: `历史记录：${nativeActive.id}`,
              },
            },
          ],
          leafId: nativeActive.id.startsWith("new-") ? null : "entry",
        };
        break;
      case "get_btw_history":
        response = { records: [] };
        break;
      case "get_available_commands":
        response = {
          commands: [{ name: "resume", description: "继续原生会话" }],
        };
        break;
      default:
        throw new Error(`未实现的原生测试请求：${command.type}`);
    }
    return response as T;
  }
  /** 注册 App 的原生事件消费者。 @param listener [in] 原生帧回调。 @returns 取消订阅函数。 */
  function onFrame(listener: (frame: RpcFrame) => void) {
    listeners.add(listener);
    /** 移除当前原生帧消费者。参数：无。 @returns 返回值：无。 */
    function unsubscribe() {
      listeners.delete(listener);
    }
    return unsubscribe;
  }
  const bridge = {
    ...offPlanBridge,
    async openSession(path: string) {
      await startBoundary?.promise;
      await historyBoundary?.promise;
      const summary = nativeCatalogue.find((session) => session.path === path)!;
      return { snapshot: {
        summary,
        messages: [{ role: "user", content: `历史记录：${summary.id}` }],
      } };
    },
    async readSession() {
      return null;
    },
    setZoomFactor: () => {},
    preferences,
    start,
    request,
    listSessions,
    onFrame,
  } satisfies Pick<
    DesktopBridge,
    | "setZoomFactor"
    | "preferences"
    | "start"
    | "request"
    | "listSessions"
    | "onFrame"
    | "openSession"
    | "readSession"
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

/** 卸载 App 并恢复监听、DOM、桥接、异步边界与 act 标志。参数：无。 @returns 清理完成的 Promise。 */
async function cleanConsumer() {
  /** 先卸载消费者，再完成本实例尚未释放的原生边界。参数：无。 @returns 原生边界清理完成的 Promise。 */
  async function unmount() {
    root.unmount();
    startBoundary?.resolve();
    historyBoundary?.resolve();
    catalogueBoundary?.resolve();
    await Promise.all([
      startBoundary?.promise,
      historyBoundary?.promise,
      catalogueBoundary?.promise,
    ]);
  }
  try {
    await act(unmount);
  } finally {
    listeners.clear();
    startBoundary = undefined;
    historyBoundary = undefined;
    catalogueBoundary = undefined;
    nativeActive = undefined;
    nativeCatalogue = [];
    container.remove();
    restoreProperty(window, "desktop", previousBridge);
    restoreProperty(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
      previousActEnvironment,
    );
  }
}

/** 挂载真实 App 并处理配置及会话目录的异步更新。参数：无。 @returns 渲染完成的 Promise。 */
async function renderApp() {
  /** 提交真实 App。参数：无。 @returns 返回值：无。 */
  function commit() {
    root.render(<App />);
  }
  await act(commit);
}

/** 获取侧栏中向消费者公开完整目录名称的项目区域。参数：无。 @returns 当前可见项目区域。 */
function projectGroups() {
  return [
    ...container.querySelectorAll<HTMLElement>("aside nav section[aria-label]"),
  ];
}

/** 读取项目区域的可访问目录名称。 @param group [in] 项目区域。 @returns 完整工作目录名称。 */
function groupDirectory(group: HTMLElement) {
  return group.getAttribute("aria-label");
}

/** 验证受控会话区域的成员与无需悬停即可辨别的父目录上下文。 @param cwd [in] 完整项目目录。 @param titles [in] 当前应显示的会话标题。 @param discriminator [in] 区别于其他同名项目的祖先目录。 @returns 当前可见的辅助标题文本。 */
function expectProject(cwd: string, titles: string[], discriminator: string) {
  const group = projectGroup(cwd);
  expect(sessionTitles(cwd)).toEqual(titles);
  const heading = group.querySelector("h2");
  expect(heading?.getAttribute("title")).toBe(cwd);
  const caption = heading?.querySelector("small")?.textContent?.trim();
  // 只比较目录片段语义，允许不同分隔符或省略号，但拒绝完整共同前缀和仅 shared 的碰撞。
  expect(caption?.match(/[A-Za-z0-9_-]+/g)).toEqual([discriminator, "shared"]);
  return caption;
}

/** 通过原生输入事件触发 React 的受控搜索更新。 @param value [in] 要输入或清空的搜索文本。 @returns 更新完成的 Promise。 */
async function searchSessions(value: string) {
  const input = container.querySelector<HTMLInputElement>("aside label input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  /** 绕过 React 的值跟踪 setter 并派发真实输入事件。参数：无。 @returns 返回值：无。 */
  function inputValue() {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input!, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await act(inputValue);
}

/** 按完整原始工作目录取得真实项目区域，不把同名项目合并。 @param cwd [in] 完整工作目录。 @returns 对应项目区域。 */
function projectGroup(cwd: string) {
  const group = projectGroups().find(
    /** 比较消费者可访问的完整目录身份。 @param candidate [in] 候选项目区域。 @returns 是否为目标项目。 */
    (candidate) => groupDirectory(candidate) === cwd,
  );
  expect(group).toBeDefined();
  return group!;
}

/** 取得项目标题中的真实语义按钮。 @param cwd [in] 完整工作目录。 @returns 可聚焦且支持本地拖动的披露按钮。 */
function projectToggle(cwd: string) {
  const button = projectGroup(cwd).querySelector<HTMLButtonElement>(
    "h2 button[aria-controls]",
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  expect(button!.type).toBe("button");
  expect(button!.draggable).toBe(false);
  expect(button!.disabled).toBe(false);
  return button!;
}

/** 通过公开的 aria-controls 解析会话成员区域。 @param cwd [in] 完整工作目录。 @returns 标题实际控制且仍留在 DOM 中的区域。 */
function sessionRegion(cwd: string) {
  const id = projectToggle(cwd).getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const region = document.getElementById(id!);
  expect(region).toBeInstanceOf(HTMLElement);
  expect(projectGroup(cwd).contains(region)).toBe(true);
  return region!;
}

/** 仅读取受控区域内的会话成员，排除标题披露按钮。 @param cwd [in] 完整工作目录。 @returns 区域中的会话标题顺序。 */
function sessionTitles(cwd: string) {
  const titles: string[] = [];
  for (const button of sessionRegion(cwd).querySelectorAll("button")) {
    titles.push(button.textContent!.trim());
  }
  return titles;
}

/** 同时验证可访问披露状态与真正控制区域的可见性。 @param cwd [in] 完整工作目录。 @param expanded [in] 期望是否展开。 @returns 稳定的受控区域 ID。 */
function expectDisclosure(cwd: string, expanded: boolean) {
  const toggle = projectToggle(cwd);
  const region = sessionRegion(cwd);
  expect(toggle.getAttribute("aria-expanded")).toBe(String(expanded));
  expect(region.hidden).toBe(!expanded);
  let matchingIds = 0;
  for (const element of container.querySelectorAll("[id]")) {
    if (element.id === region.id) matchingIds += 1;
  }
  expect(matchingIds).toBe(1);
  return region.id;
}

/** 点击真实项目披露按钮并提交 React 更新。 @param cwd [in] 完整工作目录。 @returns 更新完成的 Promise。 */
async function toggleProject(cwd: string) {
  const button = projectToggle(cwd);
  /** 派发原生按钮点击。参数：无。 @returns 返回值：无。 */
  function click() {
    button.click();
  }
  await act(click);
}

/** 挂载包含三个不同完整目录、其中两个同名且一个含两会话的真实 App。参数：无。 @returns 渲染完成的 Promise。 */
async function renderThreeProjects() {
  nativeCatalogue = [...catalogue, gammaSession];
  await renderApp();
  expect(projectGroups().map(groupDirectory)).toEqual([
    alphaCwd,
    betaCwd,
    gammaCwd,
  ]);
}

/** 点击侧栏真实刷新按钮读取已更新的本机目录。参数：无。 @returns 刷新完成的 Promise。 */
async function refreshCatalogue() {
  const button = container.querySelector<HTMLButtonElement>(
    "aside .sidebar-section button",
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  expect(button!.disabled).toBe(false);
  /** 点击侧栏目录刷新入口。参数：无。 @returns 返回值：无。 */
  function click() {
    button!.click();
  }
  await act(click);
}

/** 分发真实原生事件帧而不模拟引擎请求。 @param frame [in] 要发送的原生帧。 @returns 消费及渲染完成的 Promise。 */
async function emitFrame(frame: RpcFrame) {
  /** 向 App 当前订阅者分发帧。参数：无。 @returns 返回值：无。 */
  function emit() {
    for (const listener of listeners) listener(frame);
  }
  await act(emit);
}

/** 按消费者可见的完整文件路径取得真实会话行。 @param path [in] 原生会话文件路径。 @returns 对应会话按钮。 */
function sessionRow(path: string) {
  const row = [
    ...container.querySelectorAll<HTMLButtonElement>(".session-item"),
  ].find(
    /** 匹配 tooltip 最后一行公开的原生文件身份。 @param candidate [in] 当前会话按钮。 @returns 是否为目标路径。 */
    (candidate) => candidate.title.split("\n").at(-1) === path,
  );
  expect(row).toBeInstanceOf(HTMLButtonElement);
  return row!;
}

/** 读取真实项目的会话文件顺序，不依赖会更新的显示标题。 @param cwd [in] 完整项目目录。 @returns 该组的原生会话文件顺序。 */
function sessionPaths(cwd: string) {
  const paths: string[] = [];
  for (const row of sessionRegion(cwd).querySelectorAll<HTMLButtonElement>(
    ".session-item",
  )) {
    paths.push(row.title.split("\n").at(-1)!);
  }
  return paths;
}

/** 取得承载侧栏会话目录的真实滚动节点。参数：无。 @returns 会话导航节点。 */
function sessionScroller() {
  const scroller = container.querySelector<HTMLElement>("aside .session-list");
  expect(scroller).toBeInstanceOf(HTMLElement);
  return scroller!;
}

/** 点击消费者实际使用的会话按钮并提交原生恢复流程。 @param path [in] 原生会话文件路径。 @returns 当前可完成的异步更新处理完毕的 Promise。 */
async function clickSession(path: string) {
  const row = sessionRow(path);
  expect(row.disabled).toBe(false);
  /** 派发真实会话点击，不直接调用 App 内部函数。参数：无。 @returns 返回值：无。 */
  function click() {
    row.click();
  }
  await act(click);
}

/** 完成一个原生异步边界并处理随后可完成的 React 更新。 @param boundary [in,out] 尚未完成的原生边界。 @returns 更新完成的 Promise。 */
async function completeBoundary(boundary: Deferred<void>) {
  /** 完成原生操作并等待其 Promise。参数：无。 @returns 原生操作完成的 Promise。 */
  async function complete() {
    boundary.resolve();
    await boundary.promise;
  }
  await act(complete);
}

/** 通过真实滚动节点记录 pending 期间用户主动改变的滚动状态。 @param value [in] 用户选择的新 scrollTop。 @returns 滚动事件处理完成的 Promise。 */
async function scrollSessions(value: number) {
  /** 派发用户滚动事件，不替换 DOM 原型或几何。参数：无。 @returns 返回值：无。 */
  function scroll() {
    const scroller = sessionScroller();
    scroller.scrollTop = value;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  await act(scroll);
}

/** 验证实际原生快照驱动的选中语义及深色状态类。 @param session [in] 被恢复的原生会话摘要。 @returns 返回值：无。 */
function expectResumedSession(session: SessionSummary) {
  const row = sessionRow(session.path);
  expect(row.getAttribute("aria-current")).toBe("page");
  expect(row.classList.contains("selected")).toBe(true);
  expect([
    ...container.querySelectorAll(".session-item[aria-current='page']"),
  ]).toEqual([row]);
  expect([...container.querySelectorAll(".session-item.selected")]).toEqual([
    row,
  ]);
  expect(row.disabled).toBe(false);
}

/** 在聚焦标题上派发真正的本地重排键盘事件。 @param cwd [in] 完整工作目录。 @param key [in] 向上或向下的方向键。 @returns 已派发且被消费的事件。 */
async function reorderWithKeyboard(cwd: string, key: "ArrowUp" | "ArrowDown") {
  const button = projectToggle(cwd);
  const event = new KeyboardEvent("keydown", {
    key,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  /** 聚焦标题并让真实 React handler 处理快捷键。参数：无。 @returns 返回值：无。 */
  function keydown() {
    button.focus();
    button.dispatchEvent(event);
  }
  await act(keydown);
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(projectToggle(cwd));
  return event;
}

/** 派发真实指针事件，仅补齐 jsdom 的指针身份字段。 */
async function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  await act(() => {
    target.dispatchEvent(event);
  });
}
/** 为无布局的 jsdom 提供目录栏及标题矩形。 */
function projectGeometry() {
  vi.spyOn(sessionScroller(), "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 50, 240, 300),
  );
  projectGroups().forEach((group, index) => {
    vi.spyOn(
      projectToggle(groupDirectory(group)!),
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 100 + index * 60, 240, 40));
  });
}
/** 通过指针按下、移动和松开完成真实目录重排。 */
async function dragProject(
  sourceCwd: string,
  targetCwd: string,
  placement: "before" | "after",
) {
  projectGeometry();
  const source = projectToggle(sourceCwd);
  const from = source.getBoundingClientRect();
  const to = projectToggle(targetCwd).getBoundingClientRect();
  const y = to.top + (placement === "before" ? 10 : 30);
  try {
    await pointer(source, "pointerdown", 100, from.top + 20);
    await pointer(window, "pointermove", 100, y);
    await pointer(window, "pointerup", 100, y);
  } finally {
    vi.restoreAllMocks();
  }
}

beforeEach(prepareConsumer);
afterEach(cleanConsumer);

/** 注册同名项目在目录加载与搜索恢复过程中的身份回归。参数：无。 @returns 返回值：无。 */
function sidebarProjectIdentity() {
  /** 验证同名项目及相同直接父目录仍按完整 cwd 分组。参数：无。 @returns 测试完成的 Promise。 */
  async function distinguishSharedParentProjects() {
    await renderApp();
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd, betaCwd]);
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
    expectProject(betaCwd, [catalogue[1].title], "beta");
  }
  it(
    "同名且同直接父目录的项目显示不同祖先上下文，各会话归属完整 cwd",
    distinguishSharedParentProjects,
  );

  /** 验证标题筛选不会遗失同名项目上下文，清空后恢复原有成员。参数：无。 @returns 测试完成的 Promise。 */
  async function preserveIdentityAcrossSearch() {
    await renderApp();
    const alphaCaption = expectProject(
      alphaCwd,
      [catalogue[0].title, catalogue[2].title],
      "alpha",
    );
    const betaCaption = expectProject(betaCwd, [catalogue[1].title], "beta");
    await searchSessions(catalogue[0].title);
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd]);
    expect(expectProject(alphaCwd, [catalogue[0].title], "alpha")).toBe(
      alphaCaption,
    );
    await searchSessions("");
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd, betaCwd]);
    expect(
      expectProject(
        alphaCwd,
        [catalogue[0].title, catalogue[2].title],
        "alpha",
      ),
    ).toBe(alphaCaption);
    expect(expectProject(betaCwd, [catalogue[1].title], "beta")).toBe(
      betaCaption,
    );
  }
  it(
    "只搜索一个会话标题仍保留区别上下文，清空搜索恢复原项目与会话成员",
    preserveIdentityAcrossSearch,
  );
}

describe("侧栏项目身份", sidebarProjectIdentity);

/** 注册项目披露、搜索与本地顺序的消费者可见回归。参数：无。 @returns 返回值：无。 */
function sidebarProjectInteractions() {
  /** 验证默认展开、独立折叠以及始终可解析的唯一受控区域。参数：无。 @returns 测试完成的 Promise。 */
  async function discloseIndependentProjects() {
    await renderThreeProjects();
    const alphaId = expectDisclosure(alphaCwd, true);
    const betaId = expectDisclosure(betaCwd, true);
    const gammaId = expectDisclosure(gammaCwd, true);
    expect(new Set([alphaId, betaId, gammaId]).size).toBe(3);
    await toggleProject(alphaCwd);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(betaCwd, true);
    expectDisclosure(gammaCwd, true);
    // 折叠只隐藏受控区域，不能改动成员、目录身份或会话次序。
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
    await toggleProject(betaCwd);
    expect(expectDisclosure(betaCwd, false)).toBe(betaId);
    await toggleProject(alphaCwd);
    expect(expectDisclosure(alphaCwd, true)).toBe(alphaId);
    expectDisclosure(betaCwd, false);
    expectProject(betaCwd, [catalogue[1].title], "beta");
  }
  it(
    "同名项目独立披露且 aria-controls 始终指向保留的会话区域",
    discloseIndependentProjects,
  );

  /** 验证搜索暂时显示匹配组，同时允许搜索局部折叠并在查询改变时重置。参数：无。 @returns 测试完成的 Promise。 */
  async function restoreFoldsAfterSearch() {
    await renderThreeProjects();
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    await searchSessions(catalogue[0].title);
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd]);
    expect(expectDisclosure(alphaCwd, true)).toBe(alphaId);
    expect(sessionTitles(alphaCwd)).toEqual([catalogue[0].title]);
    await toggleProject(alphaCwd);
    expectDisclosure(alphaCwd, false);
    await toggleProject(alphaCwd);
    expectDisclosure(alphaCwd, true);
    await toggleProject(alphaCwd);
    expectDisclosure(alphaCwd, false);
    await searchSessions(catalogue[2].title);
    expect(expectDisclosure(alphaCwd, true)).toBe(alphaId);
    expect(sessionTitles(alphaCwd)).toEqual([catalogue[2].title]);
    await searchSessions("");
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      betaCwd,
      gammaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(betaCwd, true);
    // 搜索下折叠原本展开的组，不得污染正常浏览的折叠状态。
    await searchSessions(catalogue[1].title);
    await toggleProject(betaCwd);
    expectDisclosure(betaCwd, false);
    await searchSessions("");
    expectDisclosure(betaCwd, true);
    expectDisclosure(alphaCwd, false);
  }
  it(
    "搜索暂时展开、支持局部披露，查询改变重置且清空恢复原折叠",
    restoreFoldsAfterSearch,
  );

  /** 验证聚焦标题的真实 Alt 方向键改变完整组顺序而不改变披露状态。参数：无。 @returns 测试完成的 Promise。 */
  async function reorderFocusedHeaders() {
    await renderThreeProjects();
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    await reorderWithKeyboard(gammaCwd, "ArrowUp");
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      gammaCwd,
      betaCwd,
    ]);
    await reorderWithKeyboard(gammaCwd, "ArrowUp");
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      betaCwd,
    ]);
    await reorderWithKeyboard(gammaCwd, "ArrowUp");
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      betaCwd,
    ]);
    await reorderWithKeyboard(gammaCwd, "ArrowDown");
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      gammaCwd,
      betaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(gammaCwd, true);
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
    expectProject(betaCwd, [catalogue[1].title], "beta");
  }
  it(
    "Alt 上下键重排真实项目、保持焦点与折叠且边界不绕回",
    reorderFocusedHeaders,
  );

  /** 验证标题中线前后两种真实拖放都改变渲染顺序并保留完整身份。参数：无。 @returns 测试完成的 Promise。 */
  async function dropBeforeAndAfterHeaders() {
    await renderThreeProjects();
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    await dragProject(alphaCwd, gammaCwd, "after");
    expect(projectGroups().map(groupDirectory)).toEqual([
      betaCwd,
      gammaCwd,
      alphaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    await dragProject(alphaCwd, betaCwd, "before");
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      betaCwd,
      gammaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
    expectProject(betaCwd, [catalogue[1].title], "beta");
    expect(sessionTitles(gammaCwd)).toEqual([gammaSession.title]);
  }
  it(
    "真实拖放按目标标题中线上下插入且不修改会话成员或折叠",
    dropBeforeAndAfterHeaders,
  );

  /** 验证筛选后的拖放仍以完整目录顺序移动，保留隐藏中间组。参数：无。 @returns 测试完成的 Promise。 */
  async function reorderFilteredCatalogue() {
    await renderThreeProjects();
    await reorderWithKeyboard(gammaCwd, "ArrowUp");
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      gammaCwd,
      betaCwd,
    ]);
    await searchSessions("project");
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd, betaCwd]);
    expectDisclosure(alphaCwd, true);
    await dragProject(alphaCwd, betaCwd, "after");
    expect(projectGroups().map(groupDirectory)).toEqual([betaCwd, alphaCwd]);
    await searchSessions("");
    // 在完整 [alpha,gamma,beta] 中移走 alpha 后插到 beta 后，应是 [gamma,beta,alpha]。
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      betaCwd,
      alphaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(gammaCwd, true);
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
    expectProject(betaCwd, [catalogue[1].title], "beta");
  }
  it(
    "筛选中拖放按完整顺序移动，清空后隐藏组与原折叠均保留",
    reorderFilteredCatalogue,
  );

  /** 验证真实目录刷新保留手动顺序与折叠，新增目录追加且成员仍按最近修改排序。参数：无。 @returns 测试完成的 Promise。 */
  async function preserveStateAcrossCatalogueRefresh() {
    await renderThreeProjects();
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    await dragProject(gammaCwd, alphaCwd, "before");
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      betaCwd,
    ]);
    nativeCatalogue = [
      deltaSession,
      { ...catalogue[2], modified: deltaSession.modified + 100 },
      catalogue[1],
      catalogue[0],
      gammaSession,
    ];
    await refreshCatalogue();
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      betaCwd,
      deltaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(deltaCwd, true);
    expectProject(alphaCwd, [catalogue[2].title, catalogue[0].title], "alpha");
    expectProject(betaCwd, [catalogue[1].title], "beta");
    expect(sessionTitles(deltaCwd)).toEqual([deltaSession.title]);
    // 目录暂时缺失只隐藏对应组，不能扰乱其他已手动排序的项目。
    nativeCatalogue = nativeCatalogue.filter(
      /** 排除已从原生目录消失的项目。 @param session [in] 当前原生会话。 @returns 是否保留该会话。 */
      (session) => session.cwd !== betaCwd,
    );
    await refreshCatalogue();
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      deltaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(gammaCwd, true);
    expectDisclosure(deltaCwd, true);
  }
  it(
    "真实刷新保留手动顺序与折叠、新根尾部追加、缺失组隐藏且成员仍最近排序",
    preserveStateAcrossCatalogueRefresh,
  );

  it("拖动支持边缘自动滚动与滚轮，取消后保持顺序并清理监听", async () => {
    await renderThreeProjects();
    projectGeometry();
    const source = projectToggle(alphaCwd);
    const scroller = sessionScroller();
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    try {
      await pointer(source, "pointerdown", 100, 120);
      await pointer(window, "pointermove", 100, 370);
      await act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(16));
      });
      expect(scroller.scrollTop).toBeGreaterThan(0);
      const beforeWheel = scroller.scrollTop;
      const wheel = new WheelEvent("wheel", {
        deltaY: 90,
        bubbles: true,
        cancelable: true,
      });
      await act(() => {
        source.dispatchEvent(wheel);
      });
      expect(wheel.defaultPrevented).toBe(true);
      expect(scroller.scrollTop).toBe(beforeWheel + 90);
      await pointer(window, "pointermove", 100, 30);
      const beforeUp = scroller.scrollTop;
      await act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(32));
      });
      expect(scroller.scrollTop).toBeLessThan(beforeUp);
      await act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(frames.size).toBe(0);
      const idleWheel = new WheelEvent("wheel", {
        deltaY: 90,
        cancelable: true,
      });
      window.dispatchEvent(idleWheel);
      expect(idleWheel.defaultPrevented).toBe(false);
      await pointer(window, "pointerup", 100, 250);
      expect(projectGroups().map(groupDirectory)).toEqual([
        alphaCwd,
        betaCwd,
        gammaCwd,
      ]);
      await pointer(source, "pointerdown", 100, 120);
      await pointer(window, "pointermove", 100, 250);
      await pointer(window, "pointerup", 500, 250);
      expect(projectGroups().map(groupDirectory)).toEqual([
        alphaCwd,
        betaCwd,
        gammaCwd,
      ]);
    } finally {
      vi.restoreAllMocks();
    }
    await dragProject(gammaCwd, alphaCwd, "before");
    expect(projectGroups().map(groupDirectory)).toEqual([
      gammaCwd,
      alphaCwd,
      betaCwd,
    ]);
  });

  /** 忙碌和结算事件不阻止侧栏导航，也不重置本地披露与重排。 */
  async function keepLocalControlsAvailableDuringNativeBusy() {
    await renderThreeProjects();
    await toggleProject(alphaCwd);
    const alphaId = expectDisclosure(alphaCwd, false);
    await emitFrame({ type: "agent_start" });
    for (const group of projectGroups()) {
      for (const button of sessionRegion(
        groupDirectory(group)!,
      ).querySelectorAll("button")) {
        expect(button.disabled).toBe(false);
      }
    }
    await toggleProject(betaCwd);
    await reorderWithKeyboard(gammaCwd, "ArrowUp");
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      gammaCwd,
      betaCwd,
    ]);
    expect(expectDisclosure(alphaCwd, false)).toBe(alphaId);
    expectDisclosure(betaCwd, false);
    await emitFrame({ type: "agent_end" });
    // 流结束到真正结算之间也允许切换，原会话由自己的进程继续执行。
    for (const group of projectGroups()) {
      for (const button of sessionRegion(
        groupDirectory(group)!,
      ).querySelectorAll("button")) {
        expect(button.disabled).toBe(false);
      }
    }
    await emitFrame({ type: "session_settled" });
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      gammaCwd,
      betaCwd,
    ]);
    expectDisclosure(alphaCwd, false);
    expectDisclosure(betaCwd, false);
    for (const group of projectGroups()) {
      for (const button of sessionRegion(
        groupDirectory(group)!,
      ).querySelectorAll("button")) {
        expect(button.disabled).toBe(false);
      }
    }
    expectProject(alphaCwd, [catalogue[0].title, catalogue[2].title], "alpha");
  }
  it(
    "原生忙碌时会话导航与本地披露重排可用且帧更新不重置状态",
    keepLocalControlsAvailableDuringNativeBusy,
  );
}

describe("侧栏项目披露与顺序", sidebarProjectInteractions);

/** 注册真实会话恢复与目录更新的消费者可见导航稳定性回归。参数：无。 @returns 返回值：无。 */
function sidebarSessionNavigation() {
  /** 验证旧会话真实恢复后只改变选中与新摘要，不按原生 mtime 推动行或项目。参数：无。 @returns 测试完成的 Promise。 */
  async function keepRowsAcrossSuccessiveResumes() {
    await renderThreeProjects();
    const scroller = sessionScroller();
    const groups = projectGroups();
    const rows = [
      ...scroller.querySelectorAll<HTMLButtonElement>(".session-item"),
    ];
    const paths = [
      catalogue[0].path,
      catalogue[2].path,
      catalogue[1].path,
      gammaSession.path,
    ];
    await scrollSessions(137);
    // 第一次点击同组旧行，随后跨组及返回同组，原生每次都会改变 modified 与返回顺序。
    for (const session of [catalogue[2], catalogue[1], catalogue[0]]) {
      await clickSession(session.path);
      expectResumedSession(session);
      expect(projectGroups().map(groupDirectory)).toEqual([
        alphaCwd,
        betaCwd,
        gammaCwd,
      ]);
      expect(sessionPaths(alphaCwd)).toEqual([
        catalogue[0].path,
        catalogue[2].path,
      ]);
      expect(sessionPaths(betaCwd)).toEqual([catalogue[1].path]);
      expect(sessionPaths(gammaCwd)).toEqual([gammaSession.path]);
      for (let index = 0; index < groups.length; index += 1) {
        expect(projectGroups()[index]).toBe(groups[index]);
      }
      for (let index = 0; index < paths.length; index += 1) {
        expect(sessionRow(paths[index])).toBe(rows[index]);
      }
      expect(sessionScroller()).toBe(scroller);
      expect(scroller.scrollTop).toBe(137);
      const fresh = nativeCatalogue.find(
        /** 从本机目录取出恢复后写回的新摘要。 @param candidate [in] 当前原生目录成员。 @returns 是否为选中文件。 */
        (candidate) => candidate.path === session.path,
      )!;
      expect(sessionRow(session.path).textContent).toBe(fresh.title);
      expect(fresh.title).toBe(session.title);
      expect(resumeCount).toBe(0);
      expect(sessionRow(session.path).title).toContain(
        new Date(fresh.modified).toLocaleString("zh-CN"),
      );
    }
  }
  it(
    "真实恢复旧行及连续同组、跨组点击只更新原生选中与摘要，不改变组行顺序、节点或 scrollTop",
    keepRowsAcrossSuccessiveResumes,
  );

  /** 验证启动、历史与目录三个 pending 阶段都保留节点，完成后不倒退用户新滚动状态。参数：无。 @returns 测试完成的 Promise。 */
  async function preserveUserScrollingDuringResume() {
    await renderThreeProjects();
    const scroller = sessionScroller();
    const group = projectGroup(alphaCwd);
    const region = sessionRegion(alphaCwd);
    const row = sessionRow(catalogue[2].path);
    startBoundary = deferred<void>();
    historyBoundary = deferred<void>();
    catalogueBoundary = deferred<void>();
    await scrollSessions(145);
    await clickSession(catalogue[2].path);
    expect(row.disabled).toBe(true);
    expect(row.getAttribute("aria-current")).toBeNull();
    expect(scroller.scrollTop).toBe(145);
    expect(sessionRow(catalogue[2].path)).toBe(row);

    await scrollSessions(229);
    await completeBoundary(startBoundary);
    expect(sessionScroller()).toBe(scroller);
    expect(projectGroup(alphaCwd)).toBe(group);
    expect(sessionRegion(alphaCwd)).toBe(region);
    expect(sessionRow(catalogue[2].path)).toBe(row);
    expect(row.disabled).toBe(true);
    expect(row.getAttribute("aria-current")).toBeNull();
    expect(scroller.scrollTop).toBe(229);
    expect(sessionPaths(alphaCwd)).toEqual([
      catalogue[0].path,
      catalogue[2].path,
    ]);

    await scrollSessions(311);
    await completeBoundary(historyBoundary);
    expect(row.textContent).toBe(catalogue[2].title);
    expect(row.disabled).toBe(true);
    expect(scroller.scrollTop).toBe(311);
    expect(sessionRow(catalogue[2].path)).toBe(row);

    await scrollSessions(407);
    await completeBoundary(catalogueBoundary);
    expectResumedSession(catalogue[2]);
    expect(row.textContent).toBe(catalogue[2].title);
    expect(sessionScroller()).toBe(scroller);
    expect(projectGroup(alphaCwd)).toBe(group);
    expect(sessionRegion(alphaCwd)).toBe(region);
    expect(sessionRow(catalogue[2].path)).toBe(row);
    expect(sessionPaths(alphaCwd)).toEqual([
      catalogue[0].path,
      catalogue[2].path,
    ]);
    expect(projectGroups().map(groupDirectory)).toEqual([
      alphaCwd,
      betaCwd,
      gammaCwd,
    ]);
    // jsdom 只证明 DOM 身份与 scrollTop 状态；浏览器几何和 scroll anchoring 由原生 smoke 验证。
    expect(scroller.scrollTop).toBe(407);
  }
  it(
    "真实恢复在启动、历史及目录等待期间保持 DOM，用户主动滚动不会被旧点击快照复位",
    preserveUserScrollingDuringResume,
  );

  /** 验证真实恢复不会重置手动拖放顺序、无关组折叠或仍匹配的搜索。参数：无。 @returns 测试完成的 Promise。 */
  async function retainManualOrderFoldsAndSearch() {
    await renderThreeProjects();
    await toggleProject(gammaCwd);
    const gammaId = expectDisclosure(gammaCwd, false);
    await dragProject(betaCwd, alphaCwd, "before");
    expect(projectGroups().map(groupDirectory)).toEqual([
      betaCwd,
      alphaCwd,
      gammaCwd,
    ]);
    // 查询匹配稳定的 cwd，而不是会在恢复时合法更新的原生标题。
    await searchSessions("project");
    const scroller = sessionScroller();
    const alphaGroup = projectGroup(alphaCwd);
    const betaGroup = projectGroup(betaCwd);
    const alphaRow = sessionRow(catalogue[2].path);
    const betaRow = sessionRow(catalogue[1].path);
    await scrollSessions(173);
    for (const session of [catalogue[2], catalogue[1]]) {
      await clickSession(session.path);
      expectResumedSession(session);
      expect(
        container.querySelector<HTMLInputElement>("aside label input")!.value,
      ).toBe("project");
      expect(projectGroups().map(groupDirectory)).toEqual([betaCwd, alphaCwd]);
      expect(projectGroup(alphaCwd)).toBe(alphaGroup);
      expect(projectGroup(betaCwd)).toBe(betaGroup);
      expect(sessionRow(catalogue[2].path)).toBe(alphaRow);
      expect(sessionRow(catalogue[1].path)).toBe(betaRow);
      expect(sessionPaths(alphaCwd)).toEqual([
        catalogue[0].path,
        catalogue[2].path,
      ]);
      expect(sessionScroller()).toBe(scroller);
      expect(scroller.scrollTop).toBe(173);
    }
    await searchSessions("");
    expect(projectGroups().map(groupDirectory)).toEqual([
      betaCwd,
      alphaCwd,
      gammaCwd,
    ]);
    expect(expectDisclosure(gammaCwd, false)).toBe(gammaId);
    const gammaGroup = projectGroup(gammaCwd);
    const gammaRegion = sessionRegion(gammaCwd);
    await clickSession(catalogue[0].path);
    expectResumedSession(catalogue[0]);
    expect(projectGroups().map(groupDirectory)).toEqual([
      betaCwd,
      alphaCwd,
      gammaCwd,
    ]);
    expect(projectGroup(gammaCwd)).toBe(gammaGroup);
    expect(sessionRegion(gammaCwd)).toBe(gammaRegion);
    expect(expectDisclosure(gammaCwd, false)).toBe(gammaId);
  }
  it(
    "手动拖放及搜索下连续恢复保留完整项目顺序、搜索文字和无关组折叠",
    retainManualOrderFoldsAndSearch,
  );

  /** 验证自动恢复真正消费新摘要和增删成员，显式刷新仍使用原生最近顺序。参数：无。 @returns 测试完成的 Promise。 */
  async function reconcileMembershipAndExplicitRecency() {
    await renderApp();
    const scroller = sessionScroller();
    const alphaGroup = projectGroup(alphaCwd);
    const primaryRow = sessionRow(catalogue[0].path);
    const selectedRow = sessionRow(catalogue[2].path);
    const deletedRow = sessionRow(catalogue[1].path);
    const addedAlpha: SessionSummary = {
      ...catalogue[0],
      path: "D:/omp/agent/sessions/alpha-added.jsonl",
      id: "alpha-added",
      title: "New native alpha peer",
      modified: deltaSession.modified + 9000,
    };
    catalogueBoundary = deferred<void>();
    await clickSession(catalogue[2].path);
    // 原生恢复后的目录读取尚未完成时，其他客户端已增加、删除目录成员。
    const resumed = nativeCatalogue.find(
      /** 保留恢复时原生写回的摘要。 @param session [in] 当前本机成员。 @returns 是否为恢复目标。 */
      (session) => session.path === catalogue[2].path,
    )!;
    nativeCatalogue = [deltaSession, addedAlpha, resumed, catalogue[0]];
    await completeBoundary(catalogueBoundary);
    expectResumedSession(catalogue[2]);
    expect(projectGroups().map(groupDirectory)).toEqual([alphaCwd, deltaCwd]);
    expect(projectGroup(alphaCwd)).toBe(alphaGroup);
    expect(sessionPaths(alphaCwd)).toEqual([
      catalogue[0].path,
      catalogue[2].path,
      addedAlpha.path,
    ]);
    expect(sessionRow(catalogue[0].path)).toBe(primaryRow);
    expect(sessionRow(catalogue[2].path)).toBe(selectedRow);
    expect(selectedRow.textContent).toBe(resumed.title);
    expect(sessionRow(addedAlpha.path).textContent).toBe(addedAlpha.title);
    expect(sessionPaths(deltaCwd)).toEqual([deltaSession.path]);
    expect(deletedRow.isConnected).toBe(false);
    expect(sessionScroller()).toBe(scroller);

    const refreshed: SessionSummary = {
      ...resumed,
      title: "Renamed by another native client",
      parentSession: catalogue[0].path,
      modified: deltaSession.modified + 20000,
    };
    const newestDelta = {
      ...deltaSession,
      title: "Latest native delta metadata",
      modified: deltaSession.modified + 30000,
    } satisfies SessionSummary;
    // 故意提供非最近顺序，显式刷新必须主动按新 mtime 排序而非冻结目录。
    nativeCatalogue = [catalogue[0], addedAlpha, refreshed, newestDelta];
    await refreshCatalogue();
    expect(projectGroups().map(groupDirectory)).toEqual([deltaCwd, alphaCwd]);
    expect(sessionPaths(alphaCwd)).toEqual([
      refreshed.path,
      addedAlpha.path,
      catalogue[0].path,
    ]);
    expect(sessionRow(refreshed.path)).toBe(selectedRow);
    expect(sessionRow(catalogue[0].path)).toBe(primaryRow);
    expect(selectedRow.textContent).toBe(refreshed.title);
    expect(selectedRow.title).toContain(
      new Date(refreshed.modified).toLocaleString("zh-CN"),
    );
    expect(selectedRow.title).toContain("派生会话");
    expect(sessionRow(newestDelta.path).textContent).toBe(newestDelta.title);
    expectResumedSession(catalogue[2]);
    expect(deletedRow.isConnected).toBe(false);
  }
  it(
    "自动恢复更新标题和原生增删成员但保留存活路径位置，显式刷新仍更新元数据并按最近排序",
    reconcileMembershipAndExplicitRecency,
  );
}

describe("侧栏真实会话导航稳定性", sidebarSessionNavigation);

it("Ctrl 累加选中不切换当前会话，右键已选成员保留批量目标", async () => {
  await renderApp();
  await clickSession(catalogue[0].path);
  await act(() => sessionRow(catalogue[1].path).dispatchEvent(
    new MouseEvent("click", { bubbles: true, ctrlKey: true }),
  ));
  expect(sessionRow(catalogue[0].path).getAttribute("aria-current")).toBe("page");
  expect(sessionRow(catalogue[0].path).getAttribute("aria-pressed")).toBe("true");
  expect(sessionRow(catalogue[1].path).getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".conversation")?.textContent).toContain("历史记录：alpha-primary");
  await act(() => sessionRow(catalogue[1].path).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 200 }),
  ));
  const menu = container.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("JSONL");
  expect(menu.textContent).toContain("/seance");
  expect(menu.textContent).not.toContain("重命名");
  await act(() => sessionRow(catalogue[0].path).dispatchEvent(
    new MouseEvent("click", { bubbles: true, ctrlKey: true }),
  ));
  expect(sessionRow(catalogue[0].path).getAttribute("aria-pressed")).toBe("false");
  expect(sessionRow(catalogue[1].path).getAttribute("aria-pressed")).toBe("false");
  expect(sessionRow(catalogue[0].path).getAttribute("aria-current")).toBe("page");
});

it("右键未选成员改为单选，搜索清除隐藏批量选择", async () => {
  await renderApp();
  for (const session of catalogue.slice(0, 2))
    await act(() => sessionRow(session.path).dispatchEvent(
      new MouseEvent("click", { bubbles: true, ctrlKey: true }),
    ));
  await act(() => sessionRow(catalogue[2].path).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true }),
  ));
  expect(container.querySelectorAll(".session-item.multi-selected")).toHaveLength(0);
  expect(sessionRow(catalogue[2].path).getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector('[role="menu"]')?.textContent).toContain("重命名");
  await searchSessions("alpha");
  expect(container.querySelector('[role="menu"]')).toBeNull();
});

it("单选不显示选择条和高亮，多选才高亮，点击会话与菜单之外的区域取消选择", async () => {
  await renderApp();
  await clickSession(catalogue[0].path);
  expect(container.querySelector(".session-selection")).toBeNull();
  expect(container.querySelector(".session-item.multi-selected")).toBeNull();
  expect(container.textContent).not.toContain("已选择");
  await act(() => sessionRow(catalogue[1].path).dispatchEvent(
    new MouseEvent("click", { bubbles: true, ctrlKey: true }),
  ));
  expect(container.querySelectorAll(".session-item.multi-selected")).toHaveLength(2);
  expect(container.textContent).not.toContain("已选择");
  expect(container.textContent).not.toContain("清除选择");
  await act(() => sessionRow(catalogue[0].path).dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(container.querySelectorAll(".session-item.multi-selected")).toHaveLength(2);
  await act(() => container.querySelector(".workspace")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(container.querySelectorAll(".session-item.multi-selected")).toHaveLength(0);
  expect(sessionRow(catalogue[0].path).getAttribute("aria-current")).toBe("page");
});

it("选中项目目录后可从欢迎页新建，再跨目录新建，会话归属与空白历史正确", async () => {
  await renderApp();
  await act(() => projectToggle(betaCwd).click());
  expect(projectToggle(betaCwd).getAttribute("aria-pressed")).toBe("true");
  const newButton = container.querySelector<HTMLButtonElement>(".new-session")!;
  expect(newButton.disabled).toBe(false);
  await act(() => newButton.click());
  const first = nativeActive!;
  expect(first.cwd).toBe(betaCwd);
  expect(container.querySelector(".workspace-title p")?.textContent).toBe(betaCwd);
  expect(container.querySelector(".conversation")?.textContent).not.toContain("历史记录：");
  expect(sessionRow(first.path).getAttribute("aria-current")).toBe("page");

  await act(() => projectToggle(alphaCwd).click());
  await act(() => newButton.click());
  expect(nativeActive!.cwd).toBe(alphaCwd);
  expect(nativeActive!.path).not.toBe(first.path);
  expect(nativeCatalogue).toContainEqual(first);
  expect(nativeCatalogue).toEqual(expect.arrayContaining(catalogue));
  expect(container.querySelector(".workspace-title p")?.textContent).toBe(alphaCwd);
  expect(sessionRow(nativeActive!.path).getAttribute("aria-current")).toBe("page");
});

it("从只读历史新建使用其项目目录，同目录连续新建不复用已有会话文件", async () => {
  await renderApp();
  await clickSession(catalogue[1].path);
  expect(container.querySelector(".conversation")?.textContent).toContain("历史记录：beta-primary");
  const newButton = container.querySelector<HTMLButtonElement>(".new-session")!;
  await act(() => newButton.click());
  const firstPath = nativeActive!.path;
  expect(nativeActive!.cwd).toBe(betaCwd);
  expect(container.querySelector(".conversation")?.textContent).not.toContain("历史记录：beta-primary");
  await act(() => newButton.click());
  expect(nativeActive!.cwd).toBe(betaCwd);
  expect(nativeActive!.path).not.toBe(firstPath);
  expect(nativeCatalogue.find((session) => session.path === catalogue[1].path)).toEqual(catalogue[1]);
  expect(container.querySelector(".workspace-title p")?.textContent).toBe(betaCwd);
});
