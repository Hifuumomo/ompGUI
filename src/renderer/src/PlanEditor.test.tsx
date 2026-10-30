import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { PlanEditor, type PlanEditorHandle } from "./PlanEditor";
import { WebLinks } from "./WebLinks";
import { MessageFileLinks } from "./MessageFileLinks";

async function ready() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
    expect(container.querySelector(".plan-editor")?.getAttribute("aria-busy")).toBe("false");
  });
}
async function mount(value: string) {
  const ref = createRef<PlanEditorHandle>();
  const onDirty = vi.fn(); const onChange = vi.fn(); const onSave = vi.fn();
  const props = { documentKey: "epoch:local://PLAN.md", value, readOnly: false, onDirty, onChange, onSave };
  await render(<PlanEditor {...props} ref={ref} />);
  await ready();
  return { ref, props, onDirty, onChange, onSave };
}

describe("PlanEditor", () => {
  it("is directly editable and focus/selection alone preserves original bytes", async () => {
    const value = "\uFEFF# 中文😀\r\n\r\n- [x] 计划\r\n\r\n```ts\r\nconst x = `raw`;\r\n```";
    const editor = await mount(value);
    const textbox = container.querySelector<HTMLElement>('[role="textbox"][aria-label="计划正文（可直接编辑）"]')!;
    expect(textbox).not.toBeNull();
    expect(textbox.getAttribute("contenteditable")).toBe("true");
    await act(() => editor.ref.current!.focus());
    expect(editor.ref.current!.flush()).toBe(value);
    expect(editor.onDirty).not.toHaveBeenCalled();
    expect(editor.onChange).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "编辑计划")).toBe(false);
  });
  it("rejects flush while IME is composing and supports Ctrl+S after compositionend", async () => {
    const editor = await mount("# 中文计划\n");
    const textbox = container.querySelector<HTMLElement>('[role="textbox"]')!;
    await act(() => { textbox.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    expect(() => editor.ref.current!.flush()).toThrow("完成中文输入");
    await act(() => { textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.onSave).not.toHaveBeenCalled();
    await act(() => { textbox.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
    await act(() => { textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.ref.current!.flush()).toBe("# 中文计划\n");
    expect(editor.onSave).toHaveBeenCalledTimes(1);
  });
  it("disables editing when authority is withdrawn", async () => {
    const editor = await mount("readonly");
    await render(<PlanEditor {...editor.props} readOnly ref={editor.ref} />);
    expect(container.querySelector('[role="textbox"]')?.getAttribute("contenteditable")).toBe("false");
    await act(() => { container.querySelector('[role="textbox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(editor.onSave).not.toHaveBeenCalled();
  });
  it("renders remote images only as safe placeholders and HTML as editable source", async () => {
    await mount("![远程图](https://example.com/secret.png)\n\n<script>alert(1)</script>\n");
    expect(container.querySelector("img[src]")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".plan-image-placeholder")?.textContent).toContain("https://example.com/secret.png");
    expect(container.querySelector("[data-plan-raw]")?.textContent).toContain("<script>alert(1)</script>");
  });
  it("routes only Ctrl-click safe links through existing shared providers", async () => {
    const web = vi.fn(async () => "opened" as const); const file = vi.fn(async () => undefined);
    await render(<WebLinks.Provider value={web}><MessageFileLinks.Provider value={file}>
      <PlanEditor documentKey="links" value="[web](https://example.com)\n\n[unsafe](javascript:alert)" readOnly={false} onDirty={vi.fn()} onChange={vi.fn()} onSave={vi.fn()} />
    </MessageFileLinks.Provider></WebLinks.Provider>);
    await ready();
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')!;
    await act(() => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(web).not.toHaveBeenCalled();
    await act(() => { link.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(web).toHaveBeenCalledWith("https://example.com");
    const unsafe = container.querySelector<HTMLAnchorElement>('a[href^="javascript:"]');
    if (unsafe) await act(() => { unsafe.dispatchEvent(new MouseEvent("click", { ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(web).toHaveBeenCalledTimes(1); expect(file).not.toHaveBeenCalled();
  });
  it("reloads a distinct document with a separate source and undo history", async () => {
    const editor = await mount("# 第一份\n");
    await render(<PlanEditor {...editor.props} documentKey="new-epoch:local://OTHER.md" value={"# 第二份\r\n"} ref={editor.ref} />);
    await ready();
    expect(container.querySelector(".ProseMirror h1")?.textContent).toBe("第二份");
    expect(editor.ref.current!.flush()).toBe("# 第二份\r\n");
  });
});
