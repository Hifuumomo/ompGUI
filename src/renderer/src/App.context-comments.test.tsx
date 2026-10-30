import { offPlanBridge } from "./plan-test-fixture";
import { act, useContext } from "react";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import type { BrowserPromptContext, PromptContext } from "../../shared/prompt-context";
import type { RpcFrame, SessionEntry } from "../../shared/protocol";
import type { ProjectEntry } from "../../shared/project-browser";
import App from "./App";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";
import { container, render } from "./transcript-test-harness";

let actions: PromptContextActions | undefined;
vi.mock("./CodeReviewPanel", () => ({ CodeReviewPanel: () => { actions = useContext(PromptContexts); return <div>文件面板</div>; } }));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: ({ suspended, contextScope }: { suspended: boolean; contextScope: string | null }) => <div className="browser-panel" data-suspended={String(suspended)} data-scope={contextScope} /> }));
afterEach(() => { vi.unstubAllGlobals(); actions = undefined; });

interface TestCommand { type: string; message?: string; images?: Array<{ type: "image"; data: string; mimeType: string }>; streamingBehavior?: "steer" | "followUp" }
interface ConnectedFixture {
  request: Mock<(command: TestCommand) => Promise<unknown>>;
  frames: Set<(frame: RpcFrame) => void>;
}
async function mount() {
  const start = vi.fn();
  const request = vi.fn<(command: TestCommand) => Promise<unknown>>(async () => undefined);
  const frames = new Set<(frame: RpcFrame) => void>();
  const navigateTree = vi.fn(async () => {});
  const callbacks = new Set<(value: BrowserPromptContext) => void>();
  const scopes: (string | null)[] = [];
  const order: string[] = [];
  const resolveProjectFileLink = vi.fn<(href: string, cwd: string, allowMissing?: boolean) => Promise<ProjectEntry>>();
  vi.stubGlobal("desktop", {
    setZoomFactor: vi.fn(), preferences: async () => ({ executable: "omp.exe", cwd: "C:/project" }),
    resolveProjectFileLink,
    listSessions: async () => [
      { id: "one", path: "C:/one.jsonl", cwd: "C:/one", title: "另一个会话", timestamp: "2026-10-19", modified: 1 },
    ],
    openSession: async () => ({ snapshot: { summary: { id: "one", path: "C:/one.jsonl", cwd: "C:/one", title: "另一个会话" }, messages: [] } }),
    onFrame: (listener: (frame: RpcFrame) => void) => { frames.add(listener); return () => frames.delete(listener); }, start, request, navigateTree,
    ...offPlanBridge,
    onBrowserContext: (callback: (value: BrowserPromptContext) => void) => { order.push("subscribe"); callbacks.add(callback); return () => { callbacks.delete(callback); order.push("unsubscribe"); }; },
    setBrowserContextScope: async (scope: string | null) => { order.push(scope ? "register" : "clear"); scopes.push(scope); },
  });
  await render(<App />);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="文件与变更"]')!.click());
  return { start, request, callbacks, scopes, order, frames, navigateTree, resolveProjectFileLink };
}

async function type(input: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const composer = () => container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
const commentInput = () => document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!;
const file: PromptContext = { kind: "file", path: "C:/project/a.ts", text: "原始代码", startLine: 4, endLine: 4, representation: "source" };
const web: Extract<PromptContext, { kind: "web" }> = { kind: "web", url: "https://example.test/page", title: "页面", text: "页面引用甲" };
const diff: PromptContext = { kind: "diff", path: "C:/project/new.ts", previousPath: "C:/project/old.ts", base: null, side: "new", rows: [{ kind: "addition", newLine: 3, text: "新增代码", ending: "\r\n" }] };

async function hoverComment(number = 1) {
  await act(async () => container.querySelector<HTMLElement>(`.pending-comment-card[aria-label="评论${number}"]`)!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
}

it.each([file, web, diff])("$kind 评论保留草稿并登记待发快照，不启动或请求模型", async (context) => {
  const api = await mount();
  await type(composer(), "已有问题");
  composer().setSelectionRange(0, 2);
  await act(async () => actions!.comment(context, { x: 40, y: 60 }));
  await type(commentInput(), "解释这一段");
  await act(async () => commentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
  expect(composer().value).toBe("已有问题\n\n[评论1]");
  await hoverComment();
  expect(document.querySelector(".pending-comment-popover")?.textContent).toContain("解释这一段");
  expect(document.querySelector(".context-comment")).toBeNull();
  expect(document.activeElement).toBe(composer());
  expect(composer().selectionStart).toBe(composer().value.length);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});

it("取消不改草稿，已有评论不被覆盖，直接diff追加同样不发送", async () => {
  const api = await mount();
  await type(composer(), "保留");
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="文件与变更"]')!;
  await act(async () => actions!.comment(file, { x: 10, y: 10 }, trigger));
  expect(() => actions!.comment(web, { x: 1, y: 1 })).toThrow("请先完成或取消当前评论");
  await act(async () => commentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(composer().value).toBe("保留");
  expect(document.activeElement).toBe(trigger);
  await act(async () => actions!.append(diff));
  expect(composer().value).toContain("新增代码");
  expect(api.start).not.toHaveBeenCalled(); expect(api.request).not.toHaveBeenCalled();
});

it("浏览器仅接受当前scope，切会话后拒绝旧结果", async () => {
  const api = await mount();
  expect(api.scopes).toEqual([]);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="浏览器"]')!.click());
  const oldScope = api.scopes.find((scope) => scope !== null)!;
  await act(async () => { for (const callback of api.callbacks) callback({ scope: "stale", context: web }); });
  expect(commentInput()).toBeNull();
  await act(async () => { for (const callback of api.callbacks) callback({ scope: oldScope, context: web }); });
  await act(async () => document.querySelector<HTMLButtonElement>(".context-comment-actions button:first-child")!.click());
  const oldActions = actions!;
  const session = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("另一个会话"))!;
  await act(async () => session.click());
  await act(async () => { for (const callback of api.callbacks) callback({ scope: oldScope, context: web }); });
  expect(commentInput()).toBeNull();
  expect(() => oldActions.append(file)).toThrow("会话已变化");
  expect(api.start).not.toHaveBeenCalled(); expect(api.request).not.toHaveBeenCalled();
});

it("恢复含图片的用户草稿后，评论仍保留图片且不触发RPC或发送", async () => {
  const api = await mount();
  const entries: SessionEntry[] = [
    { id: "question", parentId: null, type: "message", timestamp: "2026-10-19T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "已有问题" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }] } },
    { id: "answer", parentId: "question", type: "message", timestamp: "2026-10-19T00:00:01Z", message: { role: "assistant", content: "回答" } },
  ];
  api.request.mockImplementation(async ({ type }) => {
    const responses: Record<string, unknown> = {
      get_state: { sessionId: "live", isSettled: true, messageCount: 2 },
      get_entries: { entries, leafId: "answer" },
      get_tree: { tree: [], leafId: "answer" },
      get_btw_history: { records: [] },
    };
    if (!Object.hasOwn(responses, type)) throw new Error(`意外请求：${type}`);
    return responses[type];
  });
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  try {
    await act(async () => {
      for (const listener of api.frames) listener({ type: "desktop_status", status: "connected" });
      for (const listener of api.frames) listener({ type: "session_info_update" });
    });
    for (const key of ["Escape", "Escape", "ArrowUp", "Enter"]) {
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
    expect(api.navigateTree).toHaveBeenCalledExactlyOnceWith("question");
    expect(composer().value).toBe("已有问题");
    const images = [...container.querySelectorAll(".draft-images img")].map((image) => image.getAttribute("src"));
    expect(images).toHaveLength(1);
    api.request.mockClear();
    await act(async () => actions!.comment(file, { x: 10, y: 10 }));
    await type(commentInput(), "补充说明");
    await act(async () => document.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.click());
    expect(composer().value.startsWith("已有问题\n\n")).toBe(true);
    expect([...container.querySelectorAll(".draft-images img")].map((image) => image.getAttribute("src"))).toEqual(images);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  } finally {
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

it("导航进入设置即收起导航，调整字号后关闭设置恢复浏览器且保留草稿", async () => {
  const api = await mount();
  await type(composer(), "已有问题");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="浏览器"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="打开会话导航"]')!.click());
  expect(container.querySelector(".sidebar-open")).not.toBeNull();
  expect(container.querySelector(".browser-panel")?.getAttribute("data-suspended")).toBe("true");
  await act(async () => container.querySelector<HTMLButtonElement>(".sidebar-footer button")!.click());
  expect(container.querySelector(".sidebar-open")).toBeNull();
  const font = container.querySelector<HTMLInputElement>('[aria-label="界面字体大小"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(font, "12");
    font.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector(".browser-panel")?.getAttribute("data-suspended")).toBe("false");
  expect(composer().value).toBe("已有问题");
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});

async function connectFixture(api: ConnectedFixture) {
  api.request.mockImplementation(async ({ type }) => {
    if (type === "get_state") return { sessionId: "live", isSettled: true, messageCount: 0 };
    if (type === "get_entries") return { entries: [], leafId: null };
    if (type === "get_tree") return { tree: [], leafId: null };
    if (type === "get_btw_history") return { records: [] };
    return undefined;
  });
  await act(async () => {
    for (const listener of api.frames) listener({ type: "desktop_status", status: "connected" });
    for (const listener of api.frames) listener({ type: "session_info_update" });
  });
}
async function addComment(context: PromptContext = file) {
  await act(async () => actions!.comment(context, { x: 10, y: 10 }));
  await type(commentInput(), "解释引用");
  await act(async () => commentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
}
async function submit() {
  await act(async () => composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
}
it("发送被拒保留token和评论，接受后仅向模型发送完整快照", async () => {
  const api = await mount();
  await connectFixture(api);
  await addComment();
  let reject = true;
  const messages: string[] = [];
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (command) => {
    if (command.type !== "prompt") return fallback(command);
    if (typeof command.message !== "string") throw new Error("提示词缺失");
    messages.push(command.message);
    if (reject) throw new Error("可控拒绝");
    return { agentInvoked: true };
  });
  await submit();
  expect(composer().value).toBe("[评论1]");
  expect(container.querySelector('[aria-label="待发送评论"]')).not.toBeNull();
  reject = false;
  await submit();
  expect(messages).toHaveLength(2);
  expect(messages[0]).toContain("原始代码");
  expect(messages[0]).toContain("解释引用");
  expect(messages[0]).toContain('<comment id="1">');
  expect(messages[1]).toBe(messages[0]);
  expect(composer().value).toBe("");
  expect(container.querySelector('[aria-label="待发送评论"]')).toBeNull();
});
it("发送被接受后新评论从1重新编号，同一草稿内删除后不复用编号", async () => {
  const api = await mount();
  await connectFixture(api);
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (command) => command.type === "prompt" ? { agentInvoked: true } : fallback(command));
  await addComment();
  await addComment();
  await addComment();
  expect(composer().value).toBe("[评论1]\n\n[评论2]\n\n[评论3]");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除评论3"]')!.click());
  await addComment();
  expect(composer().value).toContain("[评论4]");
  expect(composer().value).not.toContain("[评论3]");
  await submit();
  expect(composer().value).toBe("");
  await addComment();
  expect(composer().value).toBe("[评论1]");
});
it("旧提交返回不会清除用户后来编辑的草稿和评论", async () => {
  const api = await mount();
  await connectFixture(api);
  await addComment();
  const acceptance = Promise.withResolvers<unknown>();
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation((command) => command.type === "prompt" ? acceptance.promise : fallback(command));
  await submit();
  await type(composer(), "后来补充 [评论1]");
  await act(async () => acceptance.resolve({ agentInvoked: true }));
  expect(composer().value).toBe("后来补充 [评论1]");
  await hoverComment();
  expect(document.querySelector(".pending-comment-popover")?.textContent).toContain("解释引用");
});
it("移除最后一个token隐藏评论，撤销恢复；删除列表项不影响其他文本", async () => {
  await mount();
  await addComment();
  await type(composer(), "保留文字");
  expect(container.querySelector('[aria-label="待发送评论"]')).toBeNull();
  await type(composer(), "保留文字 [评论1]");
  expect(container.querySelector('[aria-label="待发送评论"]')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="待发送评论"] button:last-child')!.click());
  expect(composer().value).toBe("保留文字 ");
  expect(container.querySelector('[aria-label="待发送评论"]')).toBeNull();
});

it("画笔编辑同一评论不追加编号或替换来源快照，垃圾桶删除有效token但保留转义文字", async () => {
  await mount();
  await addComment();
  await type(composer(), String.raw`比较 [评论1] 再看 [评论1]，字面 \[评论1]`);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="定位并编辑评论1"]')!.click());
  expect(commentInput().value).toBe("解释引用");
  await act(async () => document.querySelector<HTMLButtonElement>(".context-comment-heading button")!.click());
  expect(document.querySelector(".context-comment-preview")?.textContent).toContain("原始代码");
  await type(commentInput(), "修改后的评论");
  await act(async () => commentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
  expect(composer().value).toBe(String.raw`比较 [评论1] 再看 [评论1]，字面 \[评论1]`);
  await hoverComment();
  expect(document.querySelector(".pending-comment-body")?.textContent).toBe("修改后的评论");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除评论1"]')!.click());
  expect(composer().value).toBe(String.raw`比较  再看 ，字面 \[评论1]`);
  expect(container.querySelector(".pending-comment-card")).toBeNull();
});
it("定位读取期间删除评论会取消旧结果，不打开编辑器或复活token", async () => {
  const api = await mount();
  const pendingFile = Promise.withResolvers<ProjectEntry>();
  api.resolveProjectFileLink.mockReturnValue(pendingFile.promise);
  await act(async () => actions!.comment(file, { x: 10, y: 10 }, undefined, { kind: "local", path: file.path, view: "source", identity: "原始代码", startLine: 4 }));
  await type(commentInput(), "解释引用");
  await act(async () => commentInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="定位并编辑评论1"]')!.click());
  expect(commentInput()).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除评论1"]')!.click());
  await act(async () => pendingFile.resolve({ path: file.path, name: "a.ts", kind: "file" }));
  expect(commentInput()).toBeNull();
  expect(composer().value).toBe("");
  expect(container.querySelector(".pending-comment-card")).toBeNull();
});

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bLEAAAAASUVORK5CYII=";
const figure: Extract<PromptContext, { kind: "pdf" }> = {
  kind: "pdf", url: "https://example.test/paper", title: "论文", page: 2, selection: "figure", text: "图内标签",
  image: { mimeType: "image/png", width: 1, height: 1, data: png },
};
const region: Extract<PromptContext, { kind: "web-region" }> = {
  kind: "web-region", url: "https://example.test/diagram", title: "网页图",
  image: { mimeType: "image/png", width: 1, height: 1, data: btoa(atob(png) + "\0") },
};

async function restoreImageDraft(api: ConnectedFixture) {
  const entries: SessionEntry[] = [
    { id: "question", parentId: null, type: "message", timestamp: "2026-10-19T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "已有问题" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }] } },
    { id: "answer", parentId: "question", type: "message", timestamp: "2026-10-19T00:00:01Z", message: { role: "assistant", content: "回答" } },
  ];
  api.request.mockImplementation(async ({ type }) => {
    if (type === "get_state") return { sessionId: "live", isSettled: true, messageCount: 2 };
    if (type === "get_entries") return { entries, leafId: "answer" };
    if (type === "get_tree") return { tree: [], leafId: "answer" };
    if (type === "get_btw_history") return { records: [] };
    return undefined;
  });
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  try {
    await act(async () => {
      for (const listener of api.frames) listener({ type: "desktop_status", status: "connected" });
      for (const listener of api.frames) listener({ type: "session_info_update" });
    });
    for (const key of ["Escape", "Escape", "ArrowUp", "Enter"]) {
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    }
  } finally {
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
  expect(container.querySelectorAll(".draft-images img")).toHaveLength(1);
}

it("原附件与重复图像评论按首次 token 顺序发送，被拒后可原样重试并仅在接受后清理", async () => {
  const api = await mount();
  await restoreImageDraft(api);
  await addComment(figure);
  await addComment(region);
  await type(composer(), "[评论2] [评论1] [评论2]");
  const submitted: TestCommand[] = [];
  let reject = true;
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (command) => {
    if (command.type !== "prompt") return fallback(command);
    submitted.push(command);
    if (reject) throw new Error("图片请求被拒");
    return { agentInvoked: true };
  });
  await submit();
  expect(composer().value).toBe("[评论2] [评论1] [评论2]");
  expect(container.querySelectorAll(".draft-images img")).toHaveLength(1);
  expect(container.querySelectorAll(".pending-comment-card")).toHaveLength(2);
  expect(submitted[0].images?.map(({ data }) => data)).toEqual(["aW1hZ2U=", region.image.data, figure.image!.data]);
  const text = submitted[0].message!;
  expect([...text.matchAll(/"image":(\d+)\}/g)].map((match) => Number(match[1]))).toEqual([2, 3, 2]);
  expect(text.indexOf('<comment id="2">')).toBeLessThan(text.indexOf('<comment id="1">'));
  expect(text).toContain(region.url);
  expect(text).toContain(figure.url);
  expect(text).toContain("图内标签");
  expect(text).not.toContain(png);
  reject = false;
  await submit();
  expect(submitted[1]).toEqual(submitted[0]);
  expect(composer().value).toBe("");
  expect(container.querySelectorAll(".draft-images img")).toHaveLength(0);
  expect(container.querySelectorAll(".pending-comment-card")).toHaveLength(0);
});

it.each([{ ctrlKey: false, behavior: "steer" }, { ctrlKey: true, behavior: "followUp" }] as const)(
  "运行中 $behavior 的图像评论在拒绝时保留，接受时清理",
  async ({ ctrlKey, behavior }) => {
    const api = await mount();
    await connectFixture(api);
    await addComment(figure);
    await act(async () => { for (const listener of api.frames) listener({ type: "agent_start" }); });
    const submitted: TestCommand[] = [];
    let reject = true;
    const fallback = api.request.getMockImplementation()!;
    api.request.mockImplementation(async (command) => {
      if (command.type !== "prompt") return fallback(command);
      submitted.push(command);
      if (reject) throw new Error("队列请求被拒");
      return { agentInvoked: true };
    });
    const send = async () => act(async () => composer().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey, bubbles: true, cancelable: true })));
    await send();
    expect(composer().value).toBe("[评论1]");
    expect(container.querySelector(".pending-comment-card")).not.toBeNull();
    expect(submitted[0].streamingBehavior).toBe(behavior);
    expect(submitted[0].images?.map(({ data }) => data)).toEqual([figure.image!.data]);
    expect(submitted[0].message).toContain('"image":1}');
    reject = false;
    await send();
    expect(submitted[1]).toEqual(submitted[0]);
    expect(composer().value).toBe("");
    expect(container.querySelector(".pending-comment-card")).toBeNull();
  },
);

it("旧图像提交接受后不清除后来修改的附件与评论", async () => {
  const api = await mount();
  await restoreImageDraft(api);
  await addComment(figure);
  const originalText = composer().value;
  const accepted = Promise.withResolvers<unknown>();
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation((command) => command.type === "prompt" ? accepted.promise : fallback(command));
  await submit();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除草稿图片"]')!.click());
  await act(async () => accepted.resolve({ agentInvoked: true }));
  expect(composer().value).toBe(originalText);
  expect(container.querySelectorAll(".draft-images img")).toHaveLength(0);
  await hoverComment();
  expect(document.querySelector(".pending-comment-popover img")?.getAttribute("src")).toBe(`data:image/png;base64,${figure.image!.data}`);
});

it("转义及失活图像 token 不附图，只发送当前有效评论的图片", async () => {
  const api = await mount();
  await connectFixture(api);
  await addComment(figure);
  await addComment(region);
  await type(composer(), String.raw`字面 \[评论1]，仅发送 [评论2]`);
  const submitted: TestCommand[] = [];
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (command) => {
    if (command.type !== "prompt") return fallback(command);
    submitted.push(command);
    return { agentInvoked: true };
  });
  await submit();
  expect(submitted[0].images?.map(({ data }) => data)).toEqual([region.image.data]);
  expect(submitted[0].message).toContain("字面 [评论1]");
  expect(submitted[0].message).not.toContain(figure.url);
  expect(submitted[0].message).toContain('"image":1}');
});

it("GUI slash 带图像评论 token 时拒绝执行且保留完整草稿", async () => {
  const api = await mount();
  await addComment(figure);
  await type(composer(), "/agents [评论1]");
  api.request.mockClear();
  await submit();
  expect(composer().value).toBe("/agents [评论1]");
  expect(container.querySelector(".pending-comment-card")).not.toBeNull();
  expect(api.request).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="代理管理"]')).toBeNull();
});
