import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { CommentOverlayState } from "../../shared/comment-overlay";
import { CommentOverlay } from "./CommentOverlay";
import { container, render } from "./transcript-test-harness";

afterEach(() => { vi.unstubAllGlobals(); });
it("延迟的同请求回声不覆盖新输入，确认仍发送完整评论；新请求加载自身文字", async () => {
  let receive!: (state: CommentOverlayState | null) => void;
  const send = vi.fn();
  vi.stubGlobal("commentOverlay", { onState: (listener: typeof receive) => { receive = listener; return () => {}; }, ready: vi.fn(), send });
  await render(<CommentOverlay />);
  const state: CommentOverlayState = { requestId: "request1", editor: { scope: "scope", editorId: "editor1", sourceAnchor: { kind: "web", documentId: "doc", anchorId: "anchor" }, source: "页面", comment: "", theme: "light", fontSize: 20 } };
  await act(() => receive(state));
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "完整的新输入");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => receive({ ...state, editor: { ...state.editor, comment: "完整" } }));
  expect(input.value).toBe("完整的新输入");
  await act(() => container.querySelector<HTMLButtonElement>("button.confirm")!.click());
  expect(send).toHaveBeenLastCalledWith("request1", expect.objectContaining({ type: "confirm", comment: "完整的新输入" }));
  await act(() => receive({ ...state, requestId: "request2", editor: { ...state.editor, editorId: "editor2", comment: "另一条评论" } }));
  expect(input.value).toBe("另一条评论");
});

it("原生评论框Enter提交，Shift+Enter保留默认换行，输入法Enter不提交", async () => {
  let receive!: (state: CommentOverlayState | null) => void;
  const send = vi.fn();
  vi.stubGlobal("commentOverlay", { onState: (listener: typeof receive) => { receive = listener; return () => {}; }, ready: vi.fn(), send });
  await render(<CommentOverlay />);
  await act(() => receive({ requestId: "keyboard", editor: { scope: "scope", editorId: "editor", sourceAnchor: { kind: "web", documentId: "doc", anchorId: "anchor" }, source: "页面", comment: "第一行\n第二行", theme: "light", fontSize: 14 } }));
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
  send.mockClear();
  const newline = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  await act(() => {
    input.dispatchEvent(newline);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
  });
  expect(newline.defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
  const submit = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(() => input.dispatchEvent(submit));
  expect(submit.defaultPrevented).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith("keyboard", { type: "confirm", scope: "scope", editorId: "editor", comment: "第一行\n第二行" });
});

it("可信编辑器展示真实PNG，保存仅发送评论；伪造图片不能确认", async () => {
  let receive!: (state: CommentOverlayState | null) => void;
  const send = vi.fn();
  vi.stubGlobal("commentOverlay", { onState: (listener: typeof receive) => { receive = listener; return () => {}; }, ready: vi.fn(), send });
  await render(<CommentOverlay />);
  const image = { mimeType: "image/png" as const, width: 1, height: 1, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=" };
  const state: CommentOverlayState = { requestId: "image", editor: { scope: "scope", editorId: "editor", sourceAnchor: { kind: "pdf", documentId: "doc", anchorId: "anchor", page: 1, pageRect: [0, 0, 10, 10] }, image, source: "图块", comment: "保存图块", theme: "light", fontSize: 14 } };
  await act(() => receive(state));
  expect(container.querySelector("img")?.getAttribute("src")).toBe(`data:image/png;base64,${image.data}`);
  await act(() => container.querySelector<HTMLButtonElement>("button.confirm")!.click());
  expect(send).toHaveBeenLastCalledWith("image", { type: "confirm", scope: "scope", editorId: "editor", comment: "保存图块" });
  send.mockClear();
  await act(() => receive({ ...state, editor: { ...state.editor, image: { ...image, width: 2 } } }));
  expect(container.querySelector("img")).toBeNull();
  await act(() => container.querySelector<HTMLButtonElement>("button.confirm")!.click());
  expect(send).not.toHaveBeenCalled();
  expect(container.querySelector("[role=status]")?.textContent).toContain("尺寸不匹配");
});
