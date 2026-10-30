import { act } from "react";
import { expect, it } from "vitest";
import { container, render } from "./transcript-test-harness";
import { useSelectionBoundary } from "./useSelectionBoundary";

function Surface() {
  useSelectionBoundary();
  return <><aside className="sidebar">导航文字</aside><div className="conversation-review"><p>第一消息</p><p>第二消息</p><textarea defaultValue="独立输入" /></div><section className="code-review-source"><div data-diff-side="old">旧侧内容</div><div data-diff-side="new">新侧内容</div></section></>;
}

it.each([false, true])("鼠标越界后保留当前区域选区及方向（反向=%s）", async reverse => {
  await render(<Surface />);
  const root = container.querySelector(".conversation-review")!;
  const first = root.querySelector("p")!.firstChild!;
  const outside = container.querySelector(reverse ? ".sidebar" : "[data-diff-side=new]")!.firstChild!;
  await act(async () => {
    root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    document.getSelection()!.setBaseAndExtent(first, 2, outside, 2);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const selected = document.getSelection()!;
  expect(root.contains(selected.anchorNode)).toBe(true);
  expect(root.contains(selected.focusNode)).toBe(true);
  expect(selected.anchorNode).toBe(first);
  expect(selected.anchorOffset).toBe(2);
  expect(selected.toString()).not.toMatch(/导航|旧侧|新侧/);
  expect(selected.toString()).toContain(reverse ? "第一" : "第二消息");
});

it("并排差异两侧独立，鼠标松开后不限制新的程序选区", async () => {
  await render(<Surface />);
  const left = container.querySelector("[data-diff-side=old]")!;
  const right = container.querySelector("[data-diff-side=new]")!;
  await act(async () => {
    left.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    document.getSelection()!.setBaseAndExtent(left.firstChild!, 1, right.firstChild!, 3);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(document.getSelection()!.toString()).toBe("侧内容");
  await act(async () => {
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    document.getSelection()!.setBaseAndExtent(right.firstChild!, 0, right.firstChild!, 3);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(document.getSelection()!.toString()).toBe("新侧内");
});

it("区域内跨消息选区不截断，输入框仍保留原生选择", async () => {
  await render(<Surface />);
  const root = container.querySelector(".conversation-review")!;
  const messages = root.querySelectorAll("p");
  await act(async () => {
    messages[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    document.getSelection()!.setBaseAndExtent(messages[0].firstChild!, 0, messages[1].firstChild!, 4);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(document.getSelection()!.toString()).toBe("第一消息第二消息");
  const input = root.querySelector("textarea")!;
  await act(async () => {
    input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
    input.focus(); input.setSelectionRange(1, 3);
    document.dispatchEvent(new Event("selectionchange"));
  });
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
});
