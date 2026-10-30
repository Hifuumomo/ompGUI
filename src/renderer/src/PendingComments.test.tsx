import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DraftComment } from "./comment-draft";
import { PendingComments } from "./PendingComments";
import { container, render } from "./transcript-test-harness";

const first: DraftComment = { id: "one", number: 1, revision: 0, context: { kind: "file", path: "/a.ts", text: "第一份原文", representation: "source" }, comment: "第一条评论" };
const second: DraftComment = { ...first, id: "two", number: 2, context: { kind: "file", path: "/b.ts", text: "第二份原文", representation: "source" }, comment: "第二条评论" };
const actions = { onEdit: vi.fn(), onDelete: vi.fn() };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
const popup = () => document.querySelector<HTMLElement>(".pending-comment-popover");
const card = (number: number) => container.querySelector<HTMLElement>(`.pending-comment-card[aria-label="评论${number}"]`)!;
async function enter(node: Element, relatedTarget: EventTarget = document.body) {
  await act(() => node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget })));
}
async function leave(node: Element, relatedTarget: EventTarget = document.body) {
  await act(() => node.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget })));
}
it("默认折叠详情，悬停只显示当前评论，跨越间隙进入浮层可继续查看，离开后收起", async () => {
  await render(<PendingComments entries={[first, second]} {...actions} />);
  expect(popup()).toBeNull();
  expect(container.textContent).not.toContain(first.comment);
  await enter(card(1));
  expect(popup()?.textContent).toContain(first.comment);
  expect(popup()?.textContent).toContain("第一份原文");
  const panel = popup()!;
  await leave(card(1), panel);
  await enter(panel, card(1));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(popup()).toBe(panel);
  await enter(card(2));
  expect(document.querySelectorAll(".pending-comment-popover")).toHaveLength(1);
  expect(popup()?.textContent).toContain(second.comment);
  expect(popup()?.textContent).not.toContain(first.comment);
  await leave(popup()!);
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(popup()).toBeNull();
});
it("Escape关闭且不冒泡到主会话，保留原焦点，移除记录不残留旧详情", async () => {
  await render(<PendingComments entries={[first, second]} {...actions} />);
  const focused = document.activeElement;
  await enter(card(1));
  expect(popup()?.textContent).toContain(first.comment);
  const bubble = vi.fn();
  window.addEventListener("keydown", bubble);
  try {
    await act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(bubble).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", bubble); }
  await enter(card(1));
  await render(<PendingComments entries={[second]} {...actions} />);
  expect(popup()).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(popup()).toBeNull();
});
it("详情内部滚动不关闭，窗口变化或外部点击关闭浮层", async () => {
  await render(<PendingComments entries={[first]} {...actions} />);
  await enter(card(1));
  await act(() => popup()!.dispatchEvent(new Event("scroll")));
  expect(popup()).not.toBeNull();
  await act(() => window.dispatchEvent(new Event("resize")));
  expect(popup()).toBeNull();
  await enter(card(1));
  await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(popup()).toBeNull();
});

it("图块仍为紧凑编号，只有详情展示真实截图和PDF页码", async () => {
  const image = { mimeType: "image/png" as const, width: 1, height: 1, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=" };
  const entry: DraftComment = { ...first, context: { kind: "pdf", url: "https://example.test/paper", title: "论文", page: 2, selection: "figure", text: "图注原文", image } };
  await render(<PendingComments entries={[entry]} {...actions} />);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).not.toContain("论文");
  await enter(card(1));
  const preview = popup()!.querySelector("img")!;
  expect(preview.getAttribute("src")).toBe(`data:image/png;base64,${image.data}`);
  expect(preview.alt).toBe("评论1的选区截图");
  expect(popup()?.textContent).toContain("论文 · 第2页 · 图块");
  expect(popup()?.textContent).toContain("图注原文");
});
