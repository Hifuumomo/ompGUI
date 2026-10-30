import { act } from "react";
import { expect, it, vi } from "vitest";
import { ContextCommentPopover } from "./ContextCommentPopover";
import { render } from "./transcript-test-harness";

const context = { kind: "file" as const, path: "C:/项目/a.ts", text: "const a = 1;", representation: "source" as const, startLine: 3, endLine: 3 };

async function type(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("Enter提交完整多行评论，Shift+Enter和输入法Enter不提交或阻止默认换行", async () => {
  const confirm = vi.fn();
  await render(<ContextCommentPopover context={context} anchor={{ x: 9999, y: 9999 }} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  const dialog = document.querySelector<HTMLElement>(".context-comment")!;
  const input = dialog.querySelector("textarea")!;
  expect(document.activeElement).toBe(input);
  expect(dialog.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.disabled).toBe(true);
  await type(" 说明\n第二行 ");
  const newline = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => {
    input.dispatchEvent(newline);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
  });
  expect(newline.defaultPrevented).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  const submit = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => input.dispatchEvent(submit));
  expect(submit.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledExactlyOnceWith(" 说明\n第二行 ");
});

it("确认错误可见，超限拒绝，Tab循环且Escape不冒泡", async () => {
  const cancel = vi.fn();
  const bubble = vi.fn();
  window.addEventListener("keydown", bubble);
  try {
    await render(<ContextCommentPopover context={context} anchor={{ x: 10, y: 10 }} disabled={false} onConfirm={() => { throw new Error("会话已变化"); }} onCancel={cancel} />);
    await type("说明");
    await act(async () => document.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("会话已变化");
    await type("长".repeat(16001));
    expect(document.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.disabled).toBe(true);
    const input = document.querySelector<HTMLTextAreaElement>(".context-comment textarea")!;
    await act(async () => { input.focus(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(document.querySelector(".context-comment-heading button"));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(cancel).toHaveBeenCalledOnce();
    expect(bubble).not.toHaveBeenCalled();
  } finally { window.removeEventListener("keydown", bubble); }
});

it("pending或加载历史时保留评论但禁止确认，非模态编辑允许外部操作", async () => {
  const confirm = vi.fn();
  const cancel = vi.fn();
  await render(<ContextCommentPopover context={context} anchor={{ x: 10, y: 10 }} disabled={true} onConfirm={confirm} onCancel={cancel} />);
  await type("已经写下的评论");
  const input = document.querySelector(".context-comment textarea")!;
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  expect(confirm).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.disabled).toBe(true);
  expect(document.querySelector(".context-comment-backdrop")).toBeNull();
  const outside = document.createElement("button");
  document.body.append(outside);
  await act(async () => { outside.focus(); outside.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(document.activeElement).toBe(outside);
  expect(cancel).not.toHaveBeenCalled();
  outside.remove();
});

it("支持原评论初值和受控编辑，不改变引用快照", async () => {
  const change = vi.fn();
  const confirm = vi.fn();
  const props = { context, anchor: { x: 20, y: 20 }, disabled: false, onConfirm: confirm, onCancel: vi.fn(), onChange: change };
  await render(<ContextCommentPopover {...props} value="旧评论" confirmLabel="保存评论" />);
  expect(document.querySelector("textarea")?.value).toBe("旧评论");
  await type("新评论");
  expect(change).toHaveBeenLastCalledWith("新评论");
  await render(<ContextCommentPopover {...props} value="新评论" confirmLabel="保存评论" />);
  await act(async () => document.querySelector<HTMLButtonElement>(".context-comment-actions button:last-child")!.click());
  expect(confirm).toHaveBeenCalledExactlyOnceWith("新评论");
});

it("快照默认不挂载，按钮展开完整长引用再收起，保留正在输入的评论且不确认", async () => {
  const confirm = vi.fn();
  const text = `首行\n${"正文\n".repeat(300)}最后一行`;
  await render(<ContextCommentPopover context={{ ...context, text }} anchor={{ x: 20, y: 20 }} disabled={false} onConfirm={confirm} onCancel={vi.fn()} />);
  await type("正在输入的评论");
  const toggle = document.querySelector<HTMLButtonElement>(".context-comment-heading button")!;
  expect(document.querySelector(".context-comment-preview")).toBeNull();
  await act(async () => toggle.click());
  expect(document.querySelector(".context-comment-preview")?.textContent).toContain(text);
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!.value).toBe("正在输入的评论");
  await act(async () => toggle.click());
  expect(document.querySelector(".context-comment-preview")).toBeNull();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!.value).toBe("正在输入的评论");
  expect(confirm).not.toHaveBeenCalled();
});
