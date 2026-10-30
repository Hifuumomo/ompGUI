// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileReferenceLink, FileReferencePreview, SafeLink } from "./FileReferenceLink";
import { MessageFileLinks, MessageFileMenu } from "./MessageFileLinks";
import { WebLinks } from "./WebLinks";
import { RichContent } from "./RichContent";
import type { ProjectImage } from "../../shared/project-browser";
import { messageFileHref } from "../../shared/message-file-link";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
const image: ProjectImage = { mimeType: "image/png", data: "aW1hZ2U=", byteSize: 5 };

/** 创建独立的可见渲染环境。参数：无。@returns 返回值：无。 */
function prepare() {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** 卸载组件并恢复全局 mock。参数：无。@returns 清理完成。 */
async function cleanup() {
  /** 清理 React 树及 portal。参数：无。@returns 返回值：无。 */
  function unmount() { root.unmount(); }
  await act(unmount);
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

/** 提交测试渲染。@param node [in] 待显示组件。@returns 渲染完成。 */
async function render(node: ReactNode) {
  /** 提交当前组件。参数：无。@returns 返回值：无。 */
  function commit() { root.render(node); }
  await act(commit);
}

/** 分发浏览器事件并提交 React 更新。@param target [in] 目标节点。@param event [in] 待分发事件。@returns 事件完成。 */
async function dispatch(target: EventTarget, event: Event) {
  /** 触发事件。参数：无。@returns 返回值：无。 */
  function fire() { target.dispatchEvent(event); }
  await act(fire);
}

/** 悬停指定链接。@param index [in] 链接序号，默认为第一个。@returns 事件完成。 */
async function hover(index = 0, elapsed = 500) {
  await dispatch(container.querySelectorAll("a")[index], new MouseEvent("mouseover", { bubbles: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
}

/** 创建可手动完成的读取请求。参数：无。@returns Promise 及其 resolve/reject 控制入口。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  /** 保存 Promise 控制器。@param success [in] 成功入口。@param failure [in] 失败入口。@returns 返回值：无。 */
  function capture(success: (value: T) => void, failure: (error: Error) => void) {
    resolve = success;
    reject = failure;
  }
  return { promise: new Promise<T>(capture), resolve, reject };
}

/** 渲染带可控读取入口的文件引用。@param href [in] 编码文件地址。@param read [in] 当前项目图片读取。@param open [in] 文件打开入口。@returns 测试组件。 */
function reference(href: string, read: (href: string) => Promise<ProjectImage>, open = vi.fn()) {
  return <FileReferencePreview.Provider value={read}><FileReferenceLink href={href} onOpen={open}>@{href}</FileReferenceLink></FileReferencePreview.Provider>;
}

beforeEach(prepare);
afterEach(cleanup);

/** 验证原始 @标签、空格路径、邮箱、代码和 Markdown 链接边界。参数：无。@returns 测试完成。 */
async function sentReferences() {
  const open = vi.fn();
  const text = '正文 src/plain.ts dev@example.com @src/a.ts, @"assets/space photo.png" `src/inline.ts` `@literal` [@src/label.ts](src/existing.ts)\n\n```text\n@src/fenced.ts\n```';
  await render(<MessageFileLinks.Provider value={open}><RichContent text={text} /></MessageFileLinks.Provider>);
  const links = [...container.querySelectorAll<HTMLAnchorElement>(".rich-file-link")];
  expect(links.map(/** 提取原始标签。@param link [in] 文件链接。@returns 标签文字。 */ (link) => link.textContent)).toEqual([
    "@src/a.ts", '@"assets/space photo.png"', "src/inline.ts", "@src/label.ts",
  ]);
  expect(links.map(/** 提取编码地址。@param link [in] 文件链接。@returns 原始 href 属性。 */ (link) => link.getAttribute("href"))).toEqual([
    "src/a.ts", "assets/space%20photo.png", "src/inline.ts", "src/existing.ts",
  ]);
  expect(container.querySelector(".rich-content")?.textContent).toContain("dev@example.com");
  expect(container.querySelector(".rich-code")?.textContent).toContain("@src/fenced.ts");
  expect(container.querySelector("p code")?.textContent).toBe("@literal");
  await dispatch(links[1], new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(open).toHaveBeenCalledWith("assets/space%20photo.png");
}
it("已发送引用可点击且保留邮箱、普通路径、代码与既有链接语义", sentReferences);

/** 安装包等非文本路径仍是文件引用，表达式、命令和无后缀路径不自动变成链接。 */
it("带目录和扩展名的产物可跳转，不依赖文本文件后缀白名单", async () => {
  const text = '`release/OMP-Desktop-1.0.0-x64.exe`、`./assets/自定义 包.payload`、`release/archive.tar.gz`、`console.log`、`npm run check`、`a/b`、`https://example.com/app.exe`\n\n```text\nrelease/fenced.exe\n```';
  await render(
    <MessageFileLinks.Provider value={vi.fn()}>
      <RichContent text={text} />
    </MessageFileLinks.Provider>,
  );
  const links = [...container.querySelectorAll<HTMLAnchorElement>(".rich-file-link")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "release/OMP-Desktop-1.0.0-x64.exe",
    "./assets/%E8%87%AA%E5%AE%9A%E4%B9%89%20%E5%8C%85.payload",
    "release/archive.tar.gz",
  ]);
  expect([...container.querySelectorAll("p code")].map((node) => node.textContent)).toEqual([
    "console.log",
    "npm run check",
    "a/b",
    "https://example.com/app.exe",
  ]);
  expect(container.querySelector(".rich-code")?.textContent).toContain("release/fenced.exe");
});

/** 验证打开入口覆盖、导航拦截和明确错误。参数：无。@returns 测试完成。 */
async function clickBehavior() {
  const contextOpen = vi.fn();
  const explicitOpen = vi.fn().mockRejectedValue(new Error("读取失败"));
  await render(<MessageFileLinks.Provider value={contextOpen}><FileReferenceLink href="src/a.ts" onOpen={explicitOpen}>@src/a.ts</FileReferenceLink></MessageFileLinks.Provider>);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  await dispatch(container.querySelector("a")!, click);
  expect(click.defaultPrevented).toBe(true);
  expect(explicitOpen).toHaveBeenCalledWith("src/a.ts");
  expect(contextOpen).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("读取失败");
  explicitOpen.mockResolvedValue(undefined);
  await dispatch(container.querySelector("a")!, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const prevented = new MouseEvent("click", { bubbles: true, cancelable: true });
  prevented.preventDefault();
  await dispatch(container.querySelector("a")!, prevented);
  expect(explicitOpen).toHaveBeenCalledTimes(2);
}
it("拦截导航、优先显式打开入口、保留错误并尊重父级拖选拦截", clickBehavior);

/** 验证文件上下文菜单和网页行为未被预览改写。参数：无。@returns 测试完成。 */
async function retainedLinkBehavior() {
  const open = vi.fn();
  const menu = vi.fn().mockRejectedValue(new Error("菜单失败"));
  const external = vi.fn();
  const openWeb = vi.fn().mockResolvedValue("opened");
  const read = vi.fn();
  vi.stubGlobal("desktop", { openExternal: external });
  await render(<WebLinks.Provider value={openWeb}><MessageFileLinks.Provider value={open}><MessageFileMenu.Provider value={menu}><FileReferencePreview.Provider value={read}><SafeLink href="src/a.ts">文件</SafeLink><SafeLink href="https://example.com/a.png">网页</SafeLink></FileReferencePreview.Provider></MessageFileMenu.Provider></MessageFileLinks.Provider></WebLinks.Provider>);
  expect(container.querySelector(".file-link-icon")).not.toBeNull();
  await dispatch(container.querySelector("a")!, new MouseEvent("contextmenu", { clientX: 20, clientY: 30, bubbles: true, cancelable: true }));
  expect(menu).toHaveBeenCalledWith("src/a.ts", 20, 30);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("菜单失败");
  await hover(1);
  expect(read).not.toHaveBeenCalled();
  await dispatch(container.querySelectorAll("a")[1], new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(openWeb).toHaveBeenCalledWith("https://example.com/a.png");
  expect(external).not.toHaveBeenCalled();
}
it("保留右键菜单、同色图标、菜单错误与网页打开逻辑", retainedLinkBehavior);

/** 验证图片只在悬停时读取，并通过 portal 显示安全数据。参数：无。@returns 测试完成。 */
async function lazyPreview() {
  const read = vi.fn().mockResolvedValue(image);
  await render(reference(messageFileHref("assets/space #%.png"), read));
  expect(read).not.toHaveBeenCalled();
  expect(document.querySelector(".file-reference-preview")).toBeNull();
  await dispatch(container.querySelector("a")!, new FocusEvent("focusin", { bubbles: true }));
  expect(read).not.toHaveBeenCalled();
  await hover(0, 499);
  expect(read).not.toHaveBeenCalled();
  expect(document.querySelector(".file-reference-preview")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(read).toHaveBeenCalledWith("assets/space%20%23%25.png");
  expect(container.querySelector(".file-reference-preview")).toBeNull();
  const popup = document.querySelector(".file-reference-preview")!;
  expect(popup.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
  await dispatch(container.querySelector("a")!, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  expect(document.querySelector(".file-reference-preview")).toBeNull();
  await render(reference("src/a.ts", read));
  await hover();
  expect(read).toHaveBeenCalledTimes(1);
}
it("仅悬停读取白名单图片，不预加载、不请求外链，并在离开时关闭", lazyPreview);

/** 验证离开、换引用和换项目后的旧读取不会复活或串图。参数：无。@returns 测试完成。 */
async function stalePreview() {
  const first = deferred<ProjectImage>();
  const second = deferred<ProjectImage>();
  const third = deferred<ProjectImage>();
  const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  await render(reference("a.png", read));
  await hover();
  await dispatch(container.querySelector("a")!, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  /** 完成已离开的读取。参数：无。@returns 返回值：无。 */
  function finishFirst() { first.resolve(image); }
  await act(finishFirst);
  expect(document.querySelector(".file-reference-preview")).toBeNull();
  await hover();
  await render(reference("b.png", read));
  await hover();
  /** 完成旧引用读取。参数：无。@returns 返回值：无。 */
  function finishSecond() { second.resolve(image); }
  await act(finishSecond);
  expect(document.querySelector(".file-reference-preview img")).toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toContain("加载中");
  const newRead = vi.fn().mockResolvedValue({ ...image, data: "bmV3" });
  await render(reference("b.png", newRead));
  await hover();
  /** 拒绝旧项目读取。参数：无。@returns 返回值：无。 */
  function finishThird() { third.reject(new Error("旧项目错误")); }
  await act(finishThird);
  expect(document.querySelector(".file-reference-preview img")?.getAttribute("src")).toContain("bmV3");
  expect(document.querySelector(".file-reference-preview")?.textContent).not.toContain("旧项目错误");
}
it("离开、切换引用及项目读取入口后丢弃过期成功和失败响应", stalePreview);

/** 验证失焦、Escape、滚动、窗口尺寸变化及卸载关闭浮层。参数：无。@returns 测试完成。 */
async function dismissPreview() {
  const read = vi.fn().mockResolvedValue(image);
  await render(reference("a.png", read));
  const events = [new Event("blur"), new KeyboardEvent("keydown", { key: "Escape" }), new Event("scroll"), new Event("resize")];
  for (const event of events) {
    await hover();
    expect(document.querySelector(".file-reference-preview")).not.toBeNull();
    await dispatch(window, event);
    expect(document.querySelector(".file-reference-preview")).toBeNull();
  }
  await hover();
  await dispatch(container.querySelector("a")!, new FocusEvent("focusout", { bubbles: true }));
  expect(document.querySelector(".file-reference-preview")).toBeNull();
  const pending = deferred<ProjectImage>();
  await render(reference("b.png", vi.fn().mockReturnValue(pending.promise)));
  await hover();
  await render(null);
  /** 完成已卸载读取。参数：无。@returns 返回值：无。 */
  function finish() { pending.resolve(image); }
  await act(finish);
  expect(document.querySelector(".file-reference-preview")).toBeNull();
}
it("失焦、Esc、滚动、resize、卸载会关闭并废弃未完成读取", dismissPreview);

/** 验证图片读取错误和浏览器解码错误均诚实显示。参数：无。@returns 测试完成。 */
async function previewFailures() {
  const read = vi.fn().mockRejectedValueOnce(new Error("文件超限")).mockResolvedValue(image);
  await render(reference("a.png", read));
  await hover();
  expect(document.querySelector('.file-reference-preview [role="alert"]')?.textContent).toContain("文件超限");
  await dispatch(container.querySelector("a")!, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  await hover();
  await dispatch(document.querySelector(".file-reference-preview img")!, new Event("error"));
  expect(document.querySelector('.file-reference-preview [role="alert"]')?.textContent).toContain("解码失败");
}
it("受安全层拒绝和解码失败时显示真实错误而非静默降级", previewFailures);

/** 验证位于右下角的链接将浮层翻转并夹紧到视口。参数：无。@returns 测试完成。 */
async function viewportPosition() {
  /** 提供链接和浮层的实际边界。参数：无。@returns 对应节点的模拟几何数据。 */
  function geometry(this: Element) {
    return this.tagName === "A" ? new DOMRect(990, 740, 30, 20) : new DOMRect(0, 0, 200, 160);
  }
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(geometry);
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal("innerHeight", 768);
  await render(reference("a.png", vi.fn().mockResolvedValue(image)));
  await hover();
  const popup = document.querySelector<HTMLDivElement>(".file-reference-preview")!;
  expect(popup.style.left).toBe("816px");
  expect(popup.style.top).toBe("572px");
}
it("portal 图片预览在视口边缘翻转并夹紧位置", viewportPosition);

it("不足500ms离开或滚动会取消等待，下次悬停重新计时", async () => {
  const read = vi.fn().mockResolvedValue(image);
  await render(reference("a.png", read));
  await hover(0, 300);
  await dispatch(container.querySelector("a")!, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(read).not.toHaveBeenCalled();
  await hover(0, 300);
  await dispatch(window, new Event("scroll"));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(read).not.toHaveBeenCalled();
  await hover(0, 499);
  expect(read).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(document.querySelector(".file-reference-preview img")?.getAttribute("src")).toContain("aW1hZ2U=");
});

it("网页上下文缺失时显示不可打开文本，不回退系统浏览器", async () => {
  const openExternal = vi.fn();
  vi.stubGlobal("desktop", { openExternal });
  await render(<SafeLink href="https://example.com">网页</SafeLink>);
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector(".rich-blocked-link")?.textContent).toBe("网页");
  expect(openExternal).not.toHaveBeenCalled();
});

it("网页主键和中键阻止导航，尊重默认拦截，并展示失败和 deferred 状态", async () => {
  const openWeb = vi.fn()
    .mockRejectedValueOnce(new Error("导航失败"))
    .mockResolvedValueOnce("deferred")
    .mockResolvedValue("opened");
  const view = (href: string) => <WebLinks.Provider value={openWeb}><SafeLink href={href}>网页</SafeLink></WebLinks.Provider>;
  await render(view("https://example.com/a"));
  const first = new MouseEvent("click", { bubbles: true, cancelable: true });
  await dispatch(container.querySelector("a")!, first);
  expect(first.defaultPrevented).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("导航失败");
  const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
  await dispatch(container.querySelector("a")!, middle);
  expect(middle.defaultPrevented).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("关闭当前对话框后查看");
  const prevented = new MouseEvent("click", { bubbles: true, cancelable: true });
  prevented.preventDefault();
  await dispatch(container.querySelector("a")!, prevented);
  expect(openWeb).toHaveBeenCalledTimes(2);
  await render(view("https://example.com/b"));
  expect(container.querySelector('[role="status"]')).toBeNull();
  await dispatch(container.querySelector("a")!, new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(openWeb).toHaveBeenLastCalledWith("https://example.com/b");
});

it("网页旧导航完成不能把延后提示写回新的链接", async () => {
  const { promise, resolve } = Promise.withResolvers<"opened" | "deferred">();
  const openWeb = vi.fn().mockReturnValueOnce(promise).mockResolvedValue("opened");
  const view = (href: string) => <WebLinks.Provider value={openWeb}><SafeLink href={href}>网页</SafeLink></WebLinks.Provider>;
  await render(view("https://example.com/a"));
  await dispatch(container.querySelector("a")!, new MouseEvent("click", { bubbles: true, cancelable: true }));
  await render(view("https://example.com/b"));
  await dispatch(container.querySelector("a")!, new MouseEvent("click", { bubbles: true, cancelable: true }));
  await act(() => resolve("deferred"));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
