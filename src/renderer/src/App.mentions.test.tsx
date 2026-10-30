import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcFrame, SessionSummary } from "../../shared/protocol";
import type { ProjectImage } from "../../shared/project-browser";
import { messageFilePath } from "../../shared/message-file-link";
import App from "./App";
import { mentionToken } from "./useFileMentions";
import { parseFileReferences } from "./file-reference-tokens";
import { container, render } from "./transcript-test-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 创建可由测试控制交付顺序的文件查询。参数：无。返回值：查询 Promise 及其完成函数。 */
function deferred() {
  let resolve!: (paths: string[]) => void;
  const promise = new Promise<string[]>((complete) => { resolve = complete; });
  return { promise, resolve };
}

/** 挂载真实 App 的本机文件搜索边界，不默认连接聊天进程。参数：无。返回值：查询、连接、RPC 模拟及原生帧入口。 */
async function mount() {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const sessions: SessionSummary[] = [
    { id: "one", path: "D:/sessions/one.jsonl", cwd: "D:/project-one", title: "第一个项目", timestamp: "2026-10-19", modified: 1 },
    { id: "two", path: "D:/sessions/two.jsonl", cwd: "D:/project-two", title: "第二个项目", timestamp: "2026-10-19", modified: 2 },
    { id: "three", path: "D:/sessions/three.jsonl", cwd: "D:/project-two", title: "同目录另一个会话", timestamp: "2026-10-19", modified: 3 },
  ];
  const searchMentionFiles = vi.fn(async (_cwd: string, _query: string) => ["src/first.ts", "dir/with space.ts", "src/last.ts"]);
  const start = vi.fn();
  /** 模拟经过解码并归属于当前项目的真实文件入口。[in] href：编码链接；[in] cwd：当前目录。返回值：文件元数据。 */
  const resolveProjectFileLink = vi.fn(async (href: string, cwd: string) => {
    const path = messageFilePath(href)!;
    return { name: path.split("/").at(-1)!, path: `${cwd}/${path}`, kind: "file" as const };
  });
  /** 模拟桌面返回的真实图片数据契约。[in] _path：绝对图片路径。返回值：PNG 资源数据。 */
  const readProjectImage = vi.fn(async (_path: string): Promise<ProjectImage> => ({ mimeType: "image/png", data: "aW1hZ2U=", byteSize: 5 }));
  /** 模拟侧栏读取所选源码。[in] _path：绝对源码路径。返回值：可观察的源码正文。 */
  const readProjectFile = vi.fn(async (_path: string) => "export const selected = true;");
  const request = vi.fn(async ({ type }: { type: string }) => {
    if (type === "get_state") return { sessionId: "live", isSettled: true };
    if (type === "get_entries") return { entries: [], leafId: null };
    if (type === "get_btw_history") return { records: [] };
    throw new Error(`意外 RPC：${type}`);
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/configured" }),
    listSessions: async () => sessions,
    openSession: async (path: string) => ({ snapshot: { summary: sessions.find((session) => session.path === path)!, messages: [] } }),
    searchMentionFiles,
    start,
    request,
    resolveProjectFileLink,
    readProjectImage,
    readProjectFile,
    /** 提供展开文件树所需的目录层次。[in] path：查询目录。返回值：当前层的文件与目录。 */
    listProjectDirectory: async (path: string) => path.endsWith("/src")
      ? [{ name: "first.ts", path: `${path}/first.ts`, kind: "file" }]
      : [{ name: "src", path: `${path}/src`, kind: "directory" }],
    /** 提供不依赖 Git 的目录状态。[in] cwd：当前工作目录。返回值：普通项目的空变更集。 */
    listProjectChanges: async (cwd: string) => ({ kind: "plain", root: cwd, base: null, files: [] }),
    ...offPlanBridge,
    onFrame: (listener: (frame: RpcFrame) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  await render(<App />);
  /** 向真实事件消费者交付原生帧。[in] frame：原生帧。返回值：无。 */
  function emit(frame: RpcFrame) {
    for (const listener of listeners) listener(frame);
  }
  return { searchMentionFiles, start, request, emit, resolveProjectFileLink, readProjectImage, readProjectFile };
}

/** 获取主聊天输入框。参数：无。返回值：真实文本域。 */
function composer() {
  return container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
}

/** 模拟用户在指定光标位置编辑草稿。[in] text：完整文本；[in] caret：光标位置；[in] end：选择终点。返回值：React 提交完成 Promise。 */
async function input(text: string, caret = text.length, end = caret) {
  await act(async () => {
    const textarea = composer();
    textarea.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.setSelectionRange(caret, end);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 模拟 composer 键盘操作。[in] key：按键名称；[in] options：修饰键或输入法状态。返回值：React 提交完成 Promise。 */
async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    composer().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  });
}

/** 获取文件候选的可见路径。参数：无。返回值：按显示顺序排列的路径。 */
function candidates() {
  return [...container.querySelectorAll(".mention-menu strong")].map((node) => node.textContent);
}

it.each([
  ["联系 dev@example.com", "联系 dev@example.com".length, undefined],
  ["@", 1, { start: 0, end: 1, query: "" }],
  ["看 (@src/a)", 9, { start: 3, end: 9, query: "src/a" }],
  ["前 @first 后 @second 末", 15, { start: 11, end: 18, query: "sec" }],
  ['看 @"my dir/file.ts" 末', 10, { start: 2, end: 19, query: "my dir" }],
  ["@'my dir/file.ts'", 8, { start: 0, end: 17, query: "my dir" }],
] as const)("光标引用解析：%s", /** 验证邮箱、原生边界及带空格引用范围。[in] text：草稿；[in] caret：光标；[in] expected：期望引用。返回值：无。 */ (text, caret, expected) => {
  expect(mentionToken(text, caret, caret)).toEqual(expected);
});

it("未连接也搜索真实配置目录，上下选择与 Enter 仅替换当前 token，保留正文并恢复光标", /** 验证主输入框补全而非发送。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  const text = "前文 @fi_tail 后文 @second";
  await input(text, text.indexOf("@fi") + 3);
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/configured", "fi");
  expect(candidates()).toHaveLength(3);
  await key("ArrowDown");
  await key("ArrowDown");
  await key("ArrowUp");
  expect(composer().getAttribute("aria-activedescendant")).toBe("mention-option-1");
  await key("Enter");
  expect(composer().value).toBe('前文 @"dir/with space.ts" 后文 @second');
  expect(composer().selectionStart).toBe('前文 @"dir/with space.ts"'.length);
  expect(composer().selectionEnd).toBe(composer().selectionStart);
  expect(document.activeElement).toBe(composer());
  expect(container.querySelector(".mention-menu")).toBeNull();
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
  await input(composer().value + " @la");
  await key("Tab");
  expect(composer().value).toBe('前文 @"dir/with space.ts" 后文 @second @src/first.ts ');
  expect(api.start).not.toHaveBeenCalled();
});

it.each(["notes/final.", "notes/with space.ts", "notes/foo@bar.ts"])("鼠标确认使用原生引号保护路径 %s，不提交任务", /** 验证真实候选点击与原生编码。[in] path：含原生引用分隔字符的文件名。返回值：测试完成 Promise。 */ async (path) => {
  const api = await mount();
  api.searchMentionFiles.mockResolvedValue([path]);
  await input("@no");
  await act(async () => container.querySelector<HTMLButtonElement>(".mention-menu button")!.click());
  expect(composer().value).toBe(`@"${path}" `);
  expect(document.activeElement).toBe(composer());
  expect(api.start).not.toHaveBeenCalled();
});

it("邮箱与非折叠选择不查询，Esc 关闭候选并隔离延迟结果，不触发全局中止", /** 验证关闭菜单优先于全局快捷键。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  await input("dev@example.com");
  await input("@file", 1, 5);
  expect(api.searchMentionFiles).not.toHaveBeenCalled();
  const pending = deferred();
  api.searchMentionFiles.mockReturnValueOnce(pending.promise);
  await input("@");
  await key("Enter");
  expect(api.start).not.toHaveBeenCalled();
  await key("Escape");
  await act(async () => pending.resolve(["late.ts"]));
  expect(container.querySelector(".mention-menu")).toBeNull();
  expect(api.request).not.toHaveBeenCalled();
  expect(composer().value).toBe("@");
  await input("@f");
  expect(candidates()).toHaveLength(3);
});

it("查询变化丢弃旧响应并重置选中项", /** 验证乱序搜索不会污染新查询。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  const old = deferred();
  api.searchMentionFiles.mockReturnValueOnce(old.promise);
  await input("@old");
  await input("@new");
  await key("ArrowDown");
  await act(async () => old.resolve(["old.ts"]));
  expect(candidates()).toEqual(["src/first.ts", "dir/with space.ts", "src/last.ts"]);
  expect(composer().getAttribute("aria-activedescendant")).toBe("mention-option-1");
  await input("@newer");
  expect(composer().getAttribute("aria-activedescendant")).toBe("mention-option-0");
});

it("只读会话使用 header cwd，切换项目后旧会话搜索结果不可见", /** 验证真实会话目录来源与跨会话异步隔离。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(".session-item")];
  await act(async () => buttons.find((button) => button.textContent?.includes("第一个项目"))!.click());
  const old = deferred();
  api.searchMentionFiles.mockReturnValueOnce(old.promise);
  await input("@same");
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/project-one", "same");
  await act(async () => buttons.find((button) => button.textContent?.includes("第二个项目"))!.click());
  api.searchMentionFiles.mockResolvedValue(["new-project.ts"]);
  await input("@same");
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/project-two", "same");
  await act(async () => old.resolve(["old-project.ts"]));
  expect(candidates()).toEqual(["new-project.ts"]);
  const sameProject = deferred();
  api.searchMentionFiles.mockReturnValueOnce(sameProject.promise);
  await input("@pending");
  await act(async () => buttons.find((button) => button.textContent?.includes("同目录另一个会话"))!.click());
  await input("@pending");
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/project-two", "pending");
  await act(async () => sameProject.resolve(["wrong-session.ts"]));
  expect(candidates()).toEqual(["new-project.ts"]);
  expect(api.start).not.toHaveBeenCalled();
});

it("输入法组合期间隐藏候选且 Enter 不补全或发送，结束组合后继续查询，slash 仍独立工作", /** 验证补全不抢输入法和 slash 键盘操作。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  await input("@f");
  await act(async () => composer().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(container.querySelector(".mention-menu")).toBeNull();
  await key("Enter");
  await key("Enter", { isComposing: true });
  expect(composer().value).toBe("@f");
  expect(api.start).not.toHaveBeenCalled();
  await act(async () => composer().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  expect(candidates()).toHaveLength(3);
  await input("/re");
  expect(container.querySelector(".mention-menu")).toBeNull();
  expect(composer().getAttribute("aria-controls")).toBe("slash-suggestions");
  await key("ArrowDown");
  expect(composer().getAttribute("aria-activedescendant")).toBe("slash-option-1");
});

it("文件搜索失败显示真实错误而不是静默降级", /** 验证查询拒绝在候选区域明确显示。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  api.searchMentionFiles.mockRejectedValueOnce(new Error("工作目录不存在"));
  await input("@");
  expect(container.querySelector('.mention-menu [role="alert"]')?.textContent).toBe("工作目录不存在");
  expect(api.start).not.toHaveBeenCalled();
});

it("移动光标切换多个引用，只替换光标 token 并保留包围标点", /** 验证 selection 事件与非尾部引用替换。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  const text = "看 (@one) 另一个 @two";
  await input(text);
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/configured", "two");
  await act(async () => {
    composer().setSelectionRange(text.indexOf("@one") + 3, text.indexOf("@one") + 3);
    composer().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(api.searchMentionFiles).toHaveBeenLastCalledWith("D:/configured", "on");
  await key("Tab");
  expect(composer().value).toBe("看 (@src/first.ts) 另一个 @two");
  expect(api.start).not.toHaveBeenCalled();
});

it("忙碌会话中的 Esc 优先关闭文件候选，不中止当前任务", /** 验证文件菜单拥有 Esc 事件且不冒泡至全局 abort。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  await act(async () => {
    api.emit({ type: "desktop_status", status: "connected" });
    api.emit({ type: "agent_start" });
  });
  await input("@f");
  await key("Escape");
  expect(container.querySelector(".mention-menu")).toBeNull();
  expect(api.request).not.toHaveBeenCalledWith({ type: "abort" });
  expect(composer().value).toBe("@f");
});

it.each([
  ["联系 dev@example.com", []],
  ['@"" @\'\' @', []],
  ['@"unfinished path', []],
  ['@"unfinished\nnext line', []],
  ["看 (@src/a.ts), 后文", [{ start: 3, end: 12, path: "src/a.ts" }]],
  ['@"my dir/final." @\'with@sign.ts\'', [
    { start: 0, end: 16, path: "my dir/final." },
    { start: 17, end: 32, path: "with@sign.ts" },
  ]],
] as const)("正文与补全共享引用边界：%s", /** 验证完整引用范围与原始正文一致。[in] text：草稿；[in] expected：完整引用范围。返回值：无。 */ (text, expected) => {
  expect(parseFileReferences(text)).toEqual(expected);
});

it("文件确认后仅Ctrl左键打开并定位侧栏，普通点击和中键不打开", /** 验证引用走现有文件打开链路，不改草稿或光标。 */ async () => {
  const api = await mount();
  await input("前文 @fi 后文", "前文 @fi".length);
  await key("Tab");
  const text = "前文 @src/first.ts 后文";
  expect(composer().value).toBe(text);
  const mirror = container.querySelector(".composer-reference-content")!;
  expect(mirror.textContent).toBe(text);
  const link = mirror.querySelector<HTMLAnchorElement>("a.rich-file-link")!;
  expect(link.textContent).toBe("@src/first.ts");
  expect(link.getAttribute("href")).toBe("src/first.ts");
  await act(/** 将光标移回已确认引用内部，验证仍保持蓝色链接。参数：无。返回值：无。 */ async () => {
    composer().setSelectionRange(7, 7);
    composer().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(mirror.querySelector("a.rich-file-link")).toBe(link);
  const caret = composer().selectionStart;
  await act(async () => link.click());
  expect(api.resolveProjectFileLink).not.toHaveBeenCalled();
  await act(async () => link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1, ctrlKey: true })));
  expect(api.resolveProjectFileLink).not.toHaveBeenCalled();
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true })));
  expect(api.readProjectFile).toHaveBeenCalledWith("D:/configured/src/first.ts");
  expect(container.querySelector(".code-review-panel")?.textContent).toContain("export const selected = true;");
  expect(composer().value).toBe(text);
  expect(composer().selectionStart).toBe(caret);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});

it("当前未完成查询不标蓝，带空格与特殊字符的确认引用保留逐字正文和链接编码", /** 验证查询与已确认引用区别，且镜像不改写原始字符串。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  api.searchMentionFiles.mockResolvedValue(['dir/a b#100%?.png']);
  await input("@dir");
  expect(container.querySelector(".composer-reference-content a")).toBeNull();
  await key("Escape");
  expect(container.querySelector(".composer-reference-content a")).toBeNull();
  await input("@dir/a");
  await key("Tab");
  const mirror = container.querySelector(".composer-reference-content")!;
  expect(mirror.textContent).toBe('@"dir/a b#100%?.png" ');
  expect(mirror.querySelector("a")?.getAttribute("href")).toBe("dir/a%20b%23100%25%3F.png");
  const value = composer().value;
  await input(value + "末尾\n第二行\t正文");
  expect(mirror.textContent).toBe(composer().value);
  expect(composer().selectionStart).toBe(composer().value.length);
  expect(api.start).not.toHaveBeenCalled();
});

it("镜像同步原生滚动和真实可用宽度，输入法组合仍由原生 textarea 绘制", /** 验证换行采用同一内容宽度且滚动不产生独立位置。参数：无。返回值：测试完成 Promise。 */ async () => {
  await mount();
  await input("第一行 @src/a.ts\n第二行与很长的原文\n第三行 ");
  Object.defineProperty(composer(), "clientWidth", { configurable: true, value: 307 });
  Object.defineProperty(composer(), "clientHeight", { configurable: true, value: 83 });
  await act(async () => {
    composer().scrollTop = 42;
    composer().scrollLeft = 7;
    composer().dispatchEvent(new Event("scroll"));
  });
  const viewport = container.querySelector<HTMLElement>(".composer-reference-viewport")!;
  const mirror = container.querySelector<HTMLElement>(".composer-reference-content")!;
  expect(viewport.style.width).toBe("307px");
  expect(viewport.style.height).toBe("83px");
  expect(mirror.style.transform).toBe("translate(-7px, -42px)");
  await act(async () => composer().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(container.querySelector(".composer-file-references")?.classList.contains("is-composing")).toBe(true);
  await key("Enter", { isComposing: true });
  expect(composer().value).toContain("第三行 ");
  await act(async () => composer().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  expect(container.querySelector(".composer-file-references")?.classList.contains("is-composing")).toBe(false);
});

it("图片悬停通过当前项目解析且不抢输入焦点，离开或切换会话后旧图片不出现", /** 验证 App 为 composer 安装图片入口并隔离跨会话结果。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  await input("@assets/one.png ");
  vi.useFakeTimers();
  const link = container.querySelector<HTMLAnchorElement>(".composer-reference-content a")!;
  const caret = composer().selectionStart;
  await act(async () => link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(499); });
  expect(api.readProjectImage).not.toHaveBeenCalled();
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.resolveProjectFileLink).toHaveBeenCalledWith("assets/one.png", "D:/configured");
  expect(api.readProjectImage).toHaveBeenCalledWith("D:/configured/assets/one.png");
  expect(document.body.querySelector('[role="tooltip"] img')?.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
  expect(document.activeElement).toBe(composer());
  expect(composer().selectionStart).toBe(caret);
  await act(async () => link.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: composer() })));
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  let deliver!: (image: ProjectImage) => void;
  api.readProjectImage.mockReturnValueOnce(new Promise<ProjectImage>(/** 记录可控制的图片响应。[in] resolve：Promise 完成入口。返回值：无。 */ (resolve) => { deliver = resolve; }));
  await act(async () => link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(document.body.querySelector('[role="tooltip"] [role="status"]')).not.toBeNull();
  const session = [...container.querySelectorAll<HTMLButtonElement>(".session-item")].find(/** 选择不同项目以替换悬停作用域。[in] button：会话按钮。返回值：是否为目标会话。 */ (button) => button.textContent?.includes("第一个项目"))!;
  await act(async () => session.click());
  await act(async () => deliver({ mimeType: "image/png", data: "b2xk", byteSize: 3 }));
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  expect(api.start).not.toHaveBeenCalled();
});

it("可以从蓝色引用开始拖选并复制原生正文，拖选结束不会误打开文件", /** 验证镜像链接不牺牲 textarea 的选择范围与草稿。参数：无。返回值：测试完成 Promise。 */ async () => {
  const api = await mount();
  const text = "前 @src/first.ts 后";
  await input(text);
  const mirror = container.querySelector(".composer-reference-content")!;
  const link = mirror.querySelector<HTMLAnchorElement>("a")!;
  const viewport = container.querySelector(".composer-reference-viewport")!;
  const rectangle = vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 80));
  const original = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
  let hits = 0;
  /** 向无布局 DOM 提供浏览器会返回的真实镜像文本节点。[in] _x：横坐标；[in] _y：纵坐标。返回值：镜像中的折叠文本范围。 */
  function caretAtPoint(_x: number, _y: number) {
    const range = document.createRange();
    // 光标进入未确认引用后，补全会把镜像链接还原成文本；按正文下标模拟几何命中。
    let offset = hits++ === 0 ? 4 : text.length;
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode()!;
    while (offset > (node.textContent?.length ?? 0)) {
      offset -= node.textContent?.length ?? 0;
      node = walker.nextNode()!;
    }
    range.setStart(node, offset);
    range.collapse(true);
    return range;
  }
  Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: caretAtPoint });
  try {
    await act(async () => link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 10 })));
    await act(async () => document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 10 })));
    await act(async () => document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 })));
    await act(async () => mirror.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true })));
    expect(composer().selectionStart).toBe(4);
    expect(composer().selectionEnd).toBe(text.length);
    expect(composer().value.slice(composer().selectionStart, composer().selectionEnd)).toBe(text.slice(4));
    expect(document.activeElement).toBe(composer());
    expect(composer().value).toBe(text);
    expect(api.resolveProjectFileLink).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  } finally {
    rectangle.mockRestore();
    if (original) Object.defineProperty(document, "caretRangeFromPoint", original);
    else Reflect.deleteProperty(document, "caretRangeFromPoint");
  }
});
