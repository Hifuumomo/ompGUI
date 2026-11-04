import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcFrame } from "../../shared/protocol";
import App from "./App";
import { container, render } from "./transcript-test-harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PATHS: Record<string, string> = { "a.txt": "C:\\work\\a.txt", "b c.txt": "C:\\work\\b c.txt" };

/** 挂载真实 App，桥接对象带 pathForFile。参数：无。返回值：pathForFile 模拟。 */
async function mount() {
  const pathForFile = vi.fn((file: File) => PATHS[file.name] ?? (file.name.startsWith("bulk-") ? `C:\\bulk\\${file.name}` : ""));
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "omp.exe", cwd: "D:/configured" }),
    listSessions: async () => [],
    searchMentionFiles: async () => [],
    pathForFile,
    start: vi.fn(),
    request: vi.fn(async () => ({})),
    listProjectChanges: async (cwd: string) => ({ kind: "plain", root: cwd, base: null, files: [] }),
    ...offPlanBridge,
    onFrame: (_listener: (frame: RpcFrame) => void) => () => {},
  });
  await render(<App />);
  return { pathForFile };
}

/** 获取主聊天输入框。参数：无。返回值：真实文本域。 */
function composer() {
  return container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
}

/** 模拟用户在光标位置编辑草稿。[in] text：完整文本；[in] caret：光标位置。返回值：React 提交完成 Promise。 */
async function input(text: string, caret = text.length) {
  await act(async () => {
    const textarea = composer();
    textarea.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 派发带剪贴板数据的粘贴事件。[in] types：数据类型；[in] names：文件名。返回值：事件，可检查 defaultPrevented。 */
async function paste(types: string[], names: string[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { types, files: names.map((name) => new File([], name)) } });
  await act(async () => {
    composer().dispatchEvent(event);
  });
  return event;
}

it("只有 files 时插入绝对路径并阻止默认粘贴", async () => {
  await mount();
  const event = await paste(["Files"], ["a.txt", "b c.txt"]);
  expect(composer().value).toBe('C:\\work\\a.txt "C:\\work\\b c.txt"');
  expect(event.defaultPrevented).toBe(true);
});

it("光标紧跟文字时前面补空格", async () => {
  await mount();
  await input("看一下");
  await paste(["Files"], ["a.txt"]);
  expect(composer().value).toBe("看一下 C:\\work\\a.txt");
});

it("含 text/plain 时不干预", async () => {
  await mount();
  const event = await paste(["text/plain", "Files"], ["a.txt"]);
  expect(composer().value).toBe("");
  expect(event.defaultPrevented).toBe(false);
});

it("files 全部取不到路径（截图）时不干预", async () => {
  await mount();
  const event = await paste(["Files"], ["image.png"]);
  expect(composer().value).toBe("");
  expect(event.defaultPrevented).toBe(false);
});

it("粘贴结果不触发 @ 补全菜单", async () => {
  await mount();
  await input("@");
  await paste(["Files"], ["a.txt"]);
  expect(composer().value).toBe("@ C:\\work\\a.txt");
  expect(container.querySelector("#mention-suggestions")).toBeNull();
});

it("超过 200 条只插入 200 条并提示", async () => {
  await mount();
  await paste(["Files"], Array.from({ length: 205 }, (_, index) => `bulk-${index}.txt`));
  expect(composer().value.split(" ")).toHaveLength(200);
  expect(container.textContent).toContain("一次最多粘贴 200 个路径，已忽略其余 5 个");
});
