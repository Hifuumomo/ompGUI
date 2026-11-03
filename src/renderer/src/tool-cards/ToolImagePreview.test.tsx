// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import type { MessageContent } from "../../../shared/protocol";
import { NativeImage } from "../TranscriptNativeImage";
import { click, container, image, render } from "../transcript-test-harness";
import { ToolImagePreview } from "./ToolImagePreview";

/** 通过真实 DOM 键盘事件验证捕获顺序及默认操作。 */
async function key(target: EventTarget, value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  await act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** 使用真实 PNG 数据放大，窗口只挂载到 body 且关闭后恢复原按钮焦点。 */
it("opens a validated raster in a labelled portal and restores trigger focus on close", async () => {
  await render(<ToolImagePreview image={image} label="工具截图" />);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.getAttribute("aria-label")).toBe("放大图片：工具截图");
  await click(trigger);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(
    document.getElementById(dialog.getAttribute("aria-labelledby")!)
      ?.textContent,
  ).toBe("放大图片：工具截图");
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
    `data:image/png;base64,${image.data}`,
  );
  const close = dialog.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭图片预览"]',
  )!;
  expect(document.activeElement).toBe(close);
  await click(close);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

/** Esc 优先于 App 捕获处理器与卡片、过程组冒泡处理器。 */
it("consumes Escape before application modals or parent cards and restores focus", async () => {
  const parentKey = vi.fn();
  const parentClick = vi.fn();
  await render(
    <div onKeyDown={parentKey} onClick={parentClick}>
      <ToolImagePreview image={image} label="工具截图" />
    </div>,
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  const appModalKey = vi.fn();
  const appShortcut = vi.fn();
  document.addEventListener("keydown", appModalKey, true);
  window.addEventListener("keydown", appShortcut);
  try {
    const close =
      document.querySelector<HTMLButtonElement>(".tool-image-close")!;
    const event = await key(close, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(appModalKey).not.toHaveBeenCalled();
    expect(appShortcut).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    document.removeEventListener("keydown", appModalKey, true);
    window.removeEventListener("keydown", appShortcut);
  }
});

/** 唯一可交互控件形成双向 Tab 循环，即使焦点意外移出也会返回窗口。 */
it("keeps forward and reverse Tab focus inside the viewer", async () => {
  await render(<ToolImagePreview image={image} label="工具截图" />);
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  const close = document.querySelector<HTMLButtonElement>(".tool-image-close")!;
  for (const backwards of [false, true]) {
    const event = await key(close, "Tab", backwards);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  }
  trigger.focus();
  await key(trigger, "Tab");
  expect(document.activeElement).toBe(close);
});

/** 图片及窗口内部点击不会误触遮罩关闭，也不会传播到工具卡片。 */
it("closes only for the backdrop itself, not image or dialog content", async () => {
  const parentClick = vi.fn();
  await render(
    <div onClick={parentClick}>
      <ToolImagePreview image={image} label="工具截图" />
    </div>,
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await click(dialog.querySelector<HTMLImageElement>("img")!);
  await click(dialog.querySelector<HTMLElement>(".tool-image-title")!);
  await click(dialog);
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await click(dialog.parentElement!);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(parentClick).not.toHaveBeenCalled();
});

/** 不支持的 MIME、外部地址及无效 base64 均保留证据而不提供激活入口。 */
it.each<MessageContent>([
  { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
  {
    type: "image",
    mimeType: "image/png",
    data: "https://example.com/image.png",
  },
  { type: "image", mimeType: "image/png", data: "file:///private/image.png" },
  { type: "image", mimeType: "image/png", data: "data:image/png;base64,AAAA" },
  { type: "image", mimeType: "image/png", data: "not base64!" },
  { type: "image", mimeType: "image/png", data: "" },
])("leaves invalid native image data inert: %j", async (invalid) => {
  const onOpen = vi.fn();
  await render(
    <>
      <NativeImage image={invalid} label="无效原图" onOpen={onOpen} />
      <ToolImagePreview image={invalid} label="无效工具图片" />
    </>,
  );
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(
    container.querySelectorAll("details.transcript-evidence[open]"),
  ).toHaveLength(2);
  await click(container.querySelector("summary")!);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
  expect(container.textContent).toContain(invalid.data);
});

/** 未传回调的用户、紧凑模式图片保持原有 figure > img + figcaption 结构。 */
it("preserves the default NativeImage markup without an interactive trigger", async () => {
  await render(<NativeImage image={image} label="原图" />);
  const figure = container.querySelector("figure.message-image")!;
  expect([...figure.children].map((child) => child.tagName)).toEqual([
    "IMG",
    "FIGCAPTION",
  ]);
  expect(figure.querySelector("img")?.getAttribute("alt")).toBe("原图");
  expect(figure.querySelector("figcaption")?.textContent).toBe("原图");
  expect(container.querySelector("button")).toBeNull();
  await click(figure.querySelector("img")!);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

/** 组件卸载必须移除全局捕获监听器。 */
it("removes its keyboard capture when unmounted while open", async () => {
  await render(<ToolImagePreview image={image} label="工具截图" />);
  await click(container.querySelector<HTMLButtonElement>("button")!);
  await render(null);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const event = await key(window, "Escape");
  expect(event.defaultPrevented).toBe(false);
});

/** 触发按钮已离开文档时，关闭窗口不尝试恢复无效焦点。 */
it("does not restore focus to a disconnected trigger", async () => {
  await render(<ToolImagePreview image={image} label="工具截图" />);
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await click(trigger);
  const focus = vi.spyOn(trigger, "focus");
  Object.defineProperty(trigger, "isConnected", {
    configurable: true,
    value: false,
  });
  try {
    await click(
      document.querySelector<HTMLButtonElement>(".tool-image-close")!,
    );
    expect(focus).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    Reflect.deleteProperty(trigger, "isConnected");
    focus.mockRestore();
  }
});
