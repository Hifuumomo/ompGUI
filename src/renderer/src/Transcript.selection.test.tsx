import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Transcript } from "./Transcript";
import { RichContent } from "./RichContent";
import { copyRichSelection } from "./rich-selection";
import { container, conversation, render, timeline } from "./transcript-test-harness";

afterEach(() => { vi.unstubAllGlobals(); document.getSelection()?.removeAllRanges(); });

it("对话菜单复制右键时的选区快照，不复制后来变化的文字", async () => {
  const copyText = vi.fn(async () => {});
  vi.stubGlobal("desktop", { copyText });
  await conversation([{ role: "assistant", content: "前缀 **选中内容** 后缀" }]);
  const selected = container.querySelector("strong")!;
  await act(async () => {
    document.getSelection()!.setBaseAndExtent(selected.firstChild!, 0, selected.firstChild!, 4);
    selected.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
  });
  const menu = document.querySelector('[aria-label="正文操作"]')!;
  expect(menu.querySelectorAll("button")).toHaveLength(1);
  await act(async () => { document.getSelection()!.removeAllRanges(); menu.querySelector<HTMLButtonElement>("button")!.click(); });
  expect(copyText).toHaveBeenCalledExactlyOnceWith("选中内容");
  expect(document.querySelector('[aria-label="正文操作"]')).toBeNull();
});

it("空选区和对话外选区不产生复制菜单", async () => {
  await conversation([{ role: "assistant", content: "对话正文" }]);
  const text = container.querySelector(".conversation-review p")!;
  const outside = document.createElement("p"); outside.textContent = "其他区域"; container.append(outside);
  await act(async () => {
    document.getSelection()!.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 3);
    text.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[aria-label="正文操作"]')).toBeNull();
  await act(async () => { document.getSelection()!.removeAllRanges(); text.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(document.querySelector('[aria-label="正文操作"]')).toBeNull();
});

it("复制失败保留错误，Esc 返回正文；切换会话关闭旧菜单", async () => {
  vi.stubGlobal("desktop", { copyText: vi.fn(async () => { throw new Error("剪贴板不可用"); }) });
  const messages = timeline([{ role: "assistant", content: "当前正文" }]);
  await render(<Transcript messages={messages} tools={[]} sessionId="one" />);
  const paragraph = container.querySelector(".conversation-review p")!;
  const open = async () => act(async () => { document.getSelection()!.selectAllChildren(paragraph); paragraph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  await open();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="正文操作"] button')!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("剪贴板不可用");
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.activeElement).toBe(container.querySelector(".conversation-review"));
  await open();
  await render(<Transcript messages={messages} tools={[]} sessionId="two" />);
  expect(document.querySelector('[aria-label="正文操作"]')).toBeNull();
});

function strictClipboard() {
  const copyText = vi.fn(async (_text: string) => {});
  vi.stubGlobal("desktop", new Proxy({ copyText }, {
    get(target, property, receiver) {
      if (property !== "copyText") throw new Error(`Unexpected desktop access: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  }));
  return copyText;
}

async function nativeCopy(target: Element) {
  const setData = vi.fn();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData } });
  await act(async () => { target.dispatchEvent(event); });
  return { event, setData };
}

function selectionSnapshot() {
  const selection = document.getSelection()!;
  const range = selection.getRangeAt(0);
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
    text: selection.toString(),
  };
}

async function mathContent(surface: "RichContent" | "Transcript", text: string) {
  if (surface === "Transcript") await conversation([{ role: "assistant", content: text }]);
  else await render(<RichContent text={text} />);
  const content = container.querySelector<HTMLElement>(".rich-content")!;
  expect(content.querySelector(".katex-html")).not.toBeNull();
  expect(content.querySelector('annotation[encoding="application/x-tex"]')).not.toBeNull();
  return content;
}

it.each(["RichContent", "Transcript"] as const)("%s 原生复制行内公式只包含一次 TeX 和连续中文正文", async (surface) => {
  const copyText = strictClipboard();
  const content = await mathContent(surface, String.raw`中文前文 $A\psi$ 中文后文。`);
  const paragraph = content.querySelector("p")!;
  document.getSelection()!.selectAllChildren(paragraph);
  const before = selectionSnapshot();

  const { event, setData } = await nativeCopy(paragraph);

  expect(event.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", String.raw`中文前文 $A\psi$ 中文后文。`);
  expect(selectionSnapshot()).toEqual(before);
  expect(copyText).not.toHaveBeenCalled();
});

it("块级分数复制保留原始 TeX 和双美元定界符", async () => {
  strictClipboard();
  const source = String.raw`\frac{a+b}{c_d}`;
  const content = await mathContent("RichContent", `$$\n${source}\n$$`);
  expect(content.querySelector(".katex-display")).not.toBeNull();
  expect(content.querySelector('annotation[encoding="application/x-tex"]')!.textContent).toBe(source);
  document.getSelection()!.selectAllChildren(content);

  const { event, setData } = await nativeCopy(content);

  expect(event.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", `$$\n${source}\n$$`);
});

it.each([
  ["start", String.raw`$A\psi$ 后文`],
  ["end", String.raw`前文 $A\psi$`],
  ["inside", String.raw`$A\psi$`],
  ["backward", String.raw`$A\psi$`],
] as const)("公式内部 %s 端点按完整公式复制且不改动实际选区", async (endpoint, expected) => {
  strictClipboard();
  const content = await mathContent("RichContent", String.raw`前文 $A\psi$ 后文`);
  const paragraph = content.querySelector("p")!;
  const visual = content.querySelector(".katex-html")!;
  const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
  let leaf = walker.nextNode()!;
  while (!leaf.textContent?.trim()) leaf = walker.nextNode()!;
  const length = leaf.textContent!.length;
  const selection = document.getSelection()!;
  if (endpoint === "start")
    selection.setBaseAndExtent(leaf, 0, paragraph.lastChild!, paragraph.lastChild!.textContent!.length);
  else if (endpoint === "end")
    selection.setBaseAndExtent(paragraph.firstChild!, 0, leaf, length);
  else if (endpoint === "backward")
    selection.setBaseAndExtent(leaf, length, leaf, 0);
  else
    selection.setBaseAndExtent(leaf, 0, leaf, length);
  const before = selectionSnapshot();

  const { event, setData } = await nativeCopy(visual);

  expect(event.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", expected);
  expect(selectionSnapshot()).toEqual(before);
});

it("公式混合段落与代码复制保留换段、硬换行、缩进和代码空行", async () => {
  strictClipboard();
  const code = "  alpha  beta\n\n    gamma\tend";
  const content = await mathContent("RichContent", [
    String.raw`第一段 $A\psi$。`,
    "",
    "第二段  ",
    "下一行。",
    "",
    "```text",
    code,
    "```",
    "",
    "末段。",
  ].join("\n"));
  expect(content.querySelector("pre code")!.textContent).toBe(code);
  document.getSelection()!.selectAllChildren(content);

  const { event, setData } = await nativeCopy(content);

  expect(event.defaultPrevented).toBe(true);
  expect(setData).toHaveBeenCalledExactlyOnceWith(
    "text/plain",
    `${String.raw`第一段 $A\psi$。`}\n\n第二段\n下一行。\n\n${code}\n\n末段。`,
  );
});

it.each(["RichContent", "Transcript"] as const)("%s 没有公式的选区保留浏览器默认复制", async (surface) => {
  const copyText = strictClipboard();
  const content = await mathContent(surface, String.raw`普通 **中文正文**，另有未选中的 $A\psi$。`);
  const selected = content.querySelector("strong")!;
  document.getSelection()!.selectAllChildren(selected);
  const before = selectionSnapshot();

  const { event, setData } = await nativeCopy(selected);

  expect(event.defaultPrevented).toBe(false);
  expect(setData).not.toHaveBeenCalled();
  expect(copyText).not.toHaveBeenCalled();
  expect(selectionSnapshot()).toEqual(before);
});

it("原生 clipboardData 与右键复制使用相同的公式文本且菜单保存原选区快照", async () => {
  const copyText = strictClipboard();
  const content = await mathContent("Transcript", String.raw`中文前文 $A\psi$ 中文后文。`);
  const paragraph = content.querySelector("p")!;
  document.getSelection()!.selectAllChildren(paragraph);
  const expected = String.raw`中文前文 $A\psi$ 中文后文。`;
  const { setData } = await nativeCopy(paragraph);
  expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", expected);
  await act(async () => {
    paragraph.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 50, clientY: 60,
    }));
  });
  const menu = document.querySelector('[aria-label="正文操作"]')!;
  expect(menu).not.toBeNull();
  await act(async () => {
    document.getSelection()!.removeAllRanges();
    menu.querySelector<HTMLButtonElement>("button")!.click();
  });

  expect(copyText).toHaveBeenCalledExactlyOnceWith(expected);
  expect(document.querySelector('[aria-label="正文操作"]')).toBeNull();
});

it("包含公式的选区不复制折叠详情中的隐藏源码", async () => {
  await render(<div className="copy-surface" onCopy={event => copyRichSelection(event.nativeEvent, event.currentTarget)}>
    <RichContent text="$x^2$" />
    <details><summary>查看源码</summary><pre>不应复制的隐藏源码</pre></details>
    <p>结束正文</p>
  </div>);
  const surface = container.querySelector<HTMLElement>(".copy-surface")!;
  document.getSelection()!.selectAllChildren(surface);
  const { setData } = await nativeCopy(surface);
  expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", "$x^2$\n\n查看源码\n\n结束正文");
});
