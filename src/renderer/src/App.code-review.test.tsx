import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { container, render } from "./transcript-test-harness";
import type { AgentMessage } from "../../shared/protocol";
import { inspectProjectFileLink, resolveProjectFileLink } from "../../main/message-file-link";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectBrowser } from "../../main/project-browser";
import type { BrowserPanelLayout, BrowserPanelState } from "../../shared/browser";
import type { ProjectEntry } from "../../shared/project-browser";
import { createAppFixture } from "./inline-app-test-fixture";

afterEach(() => vi.unstubAllGlobals());

function boundary(messages: AgentMessage[] = [], cwd = "D:/old-project") {
  const summary = {
    path: "D:/sessions/old.jsonl",
    cwd,
    id: "old",
    title: "历史会话",
    timestamp: "2026-10-16",
    modified: 1,
  };
  const bridge = {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "", cwd: "D:/project" }),
    listSessions: async () => [summary],
    openSession: vi.fn(async () => ({ snapshot: { summary, messages } })),
    readSession: async () => ({ summary, messages }),
    onFrame: () => () => {},
    ...offPlanBridge,
    start: vi.fn(),
    request: vi.fn(),
    listProjectDirectory: vi.fn(async (path: string) => [
      { name: "main.ts", path: `${path}/main.ts`, kind: "file" },
    ]),
    readProjectFile: vi.fn(async (_path: string) => "const value = 1;"),
    listProjectChanges: async (cwd: string) => ({
      kind: "plain",
      root: cwd,
      base: null,
      files: [],
    }),
    readProjectDiff: vi.fn(),
    resolveProjectFileLink: vi.fn(async (href: string, cwd: string, _allowMissing?: boolean) =>
      resolveProjectFileLink(href, cwd),
    ),
    openExternal: vi.fn(),
  };
  vi.stubGlobal("desktop", bridge);
  return bridge;
}

/** 仅浏览器用例安装有状态的桌面边界，不替换真实面板。 */
function withBrowser<T extends object>(bridge: T) {
  let state: BrowserPanelState = { revision: 0, url: "", title: "", loading: false, canGoBack: false, canGoForward: false, selectingElement: false };
  const listeners = new Set<(state: BrowserPanelState) => void>();
  function update(url: string) {
    state = { ...state, revision: state.revision + 1, url, title: url ? "测试网页" : "" };
    listeners.forEach((listener) => listener(state));
  }
  return Object.assign(bridge, {
    openBrowser: vi.fn(async (url: string) => update(url)),
    setBrowserLayout: vi.fn(async (_layout: BrowserPanelLayout) => {}),
    browserAction: vi.fn(async (action: string) => { if (action === "close") update(""); }),
    getBrowserState: vi.fn(async () => state),
    setBrowserContextScope: vi.fn(async (_scope: string | null) => {}),
    onBrowserContext: vi.fn(() => () => {}),
    pickBrowserElement: vi.fn(async (_scope: string) => null),
    cancelBrowserElementPick: vi.fn(async () => {}),
    onBrowserState: vi.fn((listener: (state: BrowserPanelState) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
  });
}

async function click(selector: string) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(selector)!.click();
  });
}

it("点击当前项目根路径不打开侧栏，也不改变已有文件选择", async () => {
  const bridge = boundary([
    {
      role: "assistant",
      content: [{ type: "text", text: "[项目目录](d:/OLD-project/)" }],
    },
  ]);
  await render(<App />);
  await click(".session-item");
  await click(".rich-file-link");
  expect(container.querySelector(".code-review-panel")).toBeNull();
  await click('.header-actions [aria-label="文件与变更"]');
  await click('[aria-label="查看文件 main.ts"]');
  const source = container.querySelector(".file-code-view");
  await click(".rich-file-link");
  expect(container.querySelector(".file-code-view")).toBe(source);
  expect(bridge.readProjectFile).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".project-tree-reveal")).toBeNull();
});

it("未配置引擎也能从右上角浏览；切换到只读会话后使用对应项目且不发 RPC", async () => {
  const bridge = boundary();
  await render(<App />);
  await click('.header-actions [aria-label="文件与变更"]');
  await click('[aria-label="查看文件 main.ts"]');
  expect(bridge.readProjectFile).toHaveBeenCalledWith("D:/project/main.ts");
  await click(".session-item");
  expect(bridge.listProjectDirectory).toHaveBeenLastCalledWith(
    "D:/old-project",
  );
  expect(container.querySelector(".file-code-view")).toBeNull();
  await click('[aria-label="查看文件 main.ts"]');
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:/old-project/main.ts",
  );
  await click('[aria-label="全屏显示文件与变更"]');
  await click('[aria-label="侧栏显示文件与变更"]');
  await click('[aria-label="关闭文件与变更"]');
  expect(container.querySelector(".code-review-panel")).toBeNull();
  expect(bridge.start).not.toHaveBeenCalled();
  expect(bridge.request).not.toHaveBeenCalled();
});

/** 从历史消息加载真实 Markdown，再通过 DOM 点击走通侧栏读取链路。 */
async function fileLinkFixture() {
  const bridge = withBrowser(boundary([
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "[相对文件](./decompiled/说明%20文档.cpp)",
            "[绝对文件](E:/output/main.cpp)",
            "[反斜杠文件](E:\\output\\main.cpp)",
            "[文件地址](file:///E:/output/main%20file.cpp)",
            "[网页](https://example.com)",
            "[脚本](javascript:alert%281%29)",
          ].join("\n\n"),
        },
      ],
    },
  ]));
  await render(<App />);
  await click(".session-item");
  return bridge;
}

/** 点击助手消息中的指定链接，等待异步路径解析和文件读取完成。 */
async function clickLink(label: string) {
  const link = [
    ...container.querySelectorAll<HTMLAnchorElement>(
      ".conversation-assistant a",
    ),
  ].find((node) => node.textContent === label);
  expect(link).toBeDefined();
  await act(async () => {
    link!.click();
  });
}

it("消息中的相对路径、Windows 路径和 file URL 在已有右侧面板显示源码", async () => {
  const bridge = await fileLinkFixture();
  await clickLink("相对文件");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:\\old-project\\decompiled\\说明 文档.cpp",
  );
  const panel = container.querySelector(".code-review-panel");
  expect(panel?.textContent).toContain("const value = 1;");
  await clickLink("绝对文件");
  expect(container.querySelector(".code-review-panel")).toBe(panel);
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "E:\\output\\main.cpp",
  );
  const previousReads = bridge.readProjectFile.mock.calls.length;
  await clickLink("反斜杠文件");
  expect(bridge.readProjectFile.mock.calls.length).toBeGreaterThan(
    previousReads,
  );
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "E:\\output\\main.cpp",
  );
  await clickLink("文件地址");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "E:\\output\\main file.cpp",
  );
  expect(bridge.readProjectDiff).not.toHaveBeenCalled();
  expect(bridge.openExternal).not.toHaveBeenCalled();
  await clickLink("网页");
  expect(bridge.openBrowser).toHaveBeenCalledWith("https://example.com");
  expect(bridge.openExternal).not.toHaveBeenCalled();
  expect(container.querySelector("#web-browser-panel")?.textContent).toContain("测试网页");
  expect(container.querySelector(".conversation-assistant")?.textContent).toContain("相对文件");
  expect(
    [...container.querySelectorAll("a")].some(
      (node) => node.textContent === "脚本",
    ),
  ).toBe(false);
  await click('.header-actions [aria-label="浏览器"]');
  expect(container.querySelector(".code-review-panel")).not.toBeNull();
  await click('[aria-label="关闭文件与变更"]');
  await clickLink("相对文件");
  expect(container.querySelector(".code-review-panel")).not.toBeNull();
  expect(bridge.start).not.toHaveBeenCalled();
  expect(bridge.request).not.toHaveBeenCalled();
});

it("文件读取错误显示在侧栏，后续点击可以恢复", async () => {
  const bridge = await fileLinkFixture();
  bridge.readProjectFile.mockRejectedValueOnce(new Error("文件不存在"));
  await clickLink("相对文件");
  expect(
    container.querySelector('.code-review-panel [role="alert"]')?.textContent,
  ).toBe("文件不存在");
  await clickLink("绝对文件");
  expect(
    container.querySelector('.code-review-panel [role="alert"]'),
  ).toBeNull();
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "const value = 1;",
  );
});

it.each(["missing.txt", "missing.md", "missing.html", "missing.png"])(
  "缺失的 %s 在文件侧栏提示，会话正文不追加错误且后续文件可正常打开",
  async (name) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "omp-missing-preview-"));
    try {
      await fs.writeFile(join(directory, "valid.txt"), "可正常阅读的文件内容");
      const bridge = boundary([{
        role: "assistant",
        content: [{ type: "text", text: `\`./${name}\` 与 \`valid.txt\`` }],
      }], directory);
      Object.assign(bridge, createProjectBrowser(fs));
      bridge.resolveProjectFileLink.mockImplementation(
        (href, cwd, allowMissing) => inspectProjectFileLink(href, cwd, fs.stat, allowMissing),
      );
      await render(<App />);
      await click(".session-item");
      const message = container.querySelector(".conversation-assistant")!;
      const original = message.textContent;
      await clickLink(`./${name}`);
      await vi.waitFor(() => {
        expect(container.querySelector('.code-review-panel [role="alert"]')?.textContent).toBe("找不到该文件");
      });
      expect(container.querySelector(".code-review-toolbar")?.textContent).toContain(name);
      expect(message.textContent).toBe(original);
      expect(container.querySelector(".rich-link-error")).toBeNull();
      await clickLink("valid.txt");
      await vi.waitFor(() => {
        expect(container.querySelector(".file-code-view")?.textContent).toContain("可正常阅读的文件内容");
      });
      expect(container.querySelector('.code-review-panel [role="alert"]')).toBeNull();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

it("截图中的三个行内文件名可以直接打开，代码块和普通表达式保持原样", async () => {
  const bridge = boundary([
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "已创建三个文件，每个文件各写一行：",
            "- `文件1.txt`：这是第一个文件。",
            "- `文件2.txt`：这是第二个文件。",
            "- `文件3.txt`：这是第三个文件。",
            "",
            "`./docs/说明.md` 和 `E:\\output\\另一个 文件.txt`",
            "`100%#完成.txt`",
            "`console.log`、`object.current`、`npm run dev`、`cat 文件1.txt`、`const x = 1.txt`",
            "```txt\n文件1.txt\n```",
            "[`已有标签.txt`](./actual.txt)",
            "[`引用标签.txt`][ref]\n\n[ref]: ./reference.txt",
          ].join("\n"),
        },
      ],
    },
  ]);
  bridge.readProjectFile.mockImplementation(
    async (path: string) => `文件内容：${path}`,
  );
  await render(<App />);
  await click(".session-item");
  expect(bridge.readProjectFile).not.toHaveBeenCalled();
  for (const name of ["文件1.txt", "文件2.txt", "文件3.txt"]) {
    await clickLink(name);
    expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
      `D:\\old-project\\${name}`,
    );
    expect(container.querySelector(".file-code-view")?.textContent).toContain(
      `文件内容：D:\\old-project\\${name}`,
    );
  }
  await clickLink("./docs/说明.md");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:\\old-project\\docs\\说明.md",
  );
  await clickLink("E:\\output\\另一个 文件.txt");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "E:\\output\\另一个 文件.txt",
  );
  await clickLink("100%#完成.txt");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:\\old-project\\100%#完成.txt",
  );
  await clickLink("已有标签.txt");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:\\old-project\\actual.txt",
  );
  await clickLink("引用标签.txt");
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "D:\\old-project\\reference.txt",
  );
  const message = container.querySelector(".conversation-assistant")!;
  expect(message.querySelector("a a, pre a")).toBeNull();
  expect(
    [...message.querySelectorAll("a")].map((node) => node.textContent),
  ).toEqual([
    "文件1.txt",
    "文件2.txt",
    "文件3.txt",
    "./docs/说明.md",
    "E:\\output\\另一个 文件.txt",
    "100%#完成.txt",
    "已有标签.txt",
    "引用标签.txt",
  ]);
  expect(bridge.openExternal).not.toHaveBeenCalled();
  expect(bridge.start).not.toHaveBeenCalled();
});

it("较早点击和切换会话前的迟到解析结果不会覆盖当前预览", async () => {
  const bridge = await fileLinkFixture();
  let finish!: (file: ReturnType<typeof resolveProjectFileLink>) => void;
  bridge.resolveProjectFileLink.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await clickLink("相对文件");
  await clickLink("绝对文件");
  await act(() => finish(resolveProjectFileLink("old.cpp", "D:/old-project")));
  expect(bridge.readProjectFile).toHaveBeenLastCalledWith(
    "E:\\output\\main.cpp",
  );
  bridge.resolveProjectFileLink.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await clickLink("相对文件");
  await click('[aria-label="关闭文件与变更"]');
  await click(".session-item");
  await act(() =>
    finish(resolveProjectFileLink("stale.cpp", "D:/old-project")),
  );
  expect(container.querySelector(".code-review-panel")).toBeNull();
  expect(bridge.readProjectFile).not.toHaveBeenCalledWith(
    "D:\\old-project\\stale.cpp",
  );
});

it("未连接和只读会话可打开浏览器，收起及关闭恢复文件面板且不连接引擎", async () => {
  const bridge = withBrowser(boundary());
  await render(<App />);
  expect(bridge.onBrowserState).not.toHaveBeenCalled();
  await click('.header-actions [aria-label="文件与变更"]');
  await click('.header-actions [aria-label="浏览器"]');
  expect(container.querySelector("#web-browser-panel")).not.toBeNull();
  expect(bridge.openBrowser).not.toHaveBeenCalled();
  expect(container.querySelector(".code-review-panel")).toBeNull();
  await click('.header-actions [aria-label="浏览器"]');
  expect(container.querySelector(".code-review-panel")).not.toBeNull();
  await click(".session-item");
  await click('.header-actions [aria-label="浏览器"]');
  await act(async () => { await bridge.openBrowser("https://example.com/read-only"); });
  await click('[aria-label="关闭浏览器"]');
  expect(container.querySelector(".code-review-panel")).not.toBeNull();
  await click('.header-actions [aria-label="浏览器"]');
  expect(bridge.start).not.toHaveBeenCalled();
  expect(bridge.request).not.toHaveBeenCalled();
});

it("先点击文件再点击网页时迟到文件解析不能盖回浏览器，主动文件点击可切回", async () => {
  const bridge = await fileLinkFixture();
  const { promise, resolve } = Promise.withResolvers<ProjectEntry>();
  bridge.resolveProjectFileLink.mockReturnValueOnce(promise);
  await clickLink("相对文件");
  await clickLink("网页");
  await act(() => resolve(resolveProjectFileLink("stale.cpp", "D:/old-project")));
  expect(container.querySelector(".code-review-panel")).toBeNull();
  expect(bridge.readProjectFile).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>('.header-actions [aria-label="浏览器"]')?.getAttribute("aria-expanded")).toBe("true");
  await clickLink("绝对文件");
  expect(container.querySelector(".code-review-panel")).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('.header-actions [aria-label="浏览器"]')?.getAttribute("aria-expanded")).toBe("false");
  expect(bridge.openExternal).not.toHaveBeenCalled();
  expect(bridge.start).not.toHaveBeenCalled();
  expect(bridge.request).not.toHaveBeenCalled();
});

it("Markdown 文件预览共用网页入口", async () => {
  const bridge = await fileLinkFixture();
  bridge.readProjectFile.mockResolvedValue("[预览中的网页](https://example.com/from-markdown)");
  bridge.resolveProjectFileLink.mockResolvedValueOnce(resolveProjectFileLink("notes.md", "D:/old-project"));
  await clickLink("相对文件");
  expect(container.querySelector('[aria-label="渲染预览"]')?.getAttribute("aria-pressed")).toBe("true");
  const link = [...container.querySelectorAll<HTMLAnchorElement>(".code-review-panel a")].find((node) => node.textContent === "预览中的网页");
  expect(link).toBeDefined();
  await act(() => link!.click());
  expect(bridge.openBrowser).toHaveBeenCalledWith("https://example.com/from-markdown");
  expect(bridge.openExternal).not.toHaveBeenCalled();
});

it("引擎 open_url 仍按 launchUrl 优先使用系统浏览器，不经过网页上下文", async () => {
  const app = await createAppFixture([]);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const openBrowser = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.desktop, { openExternal, openBrowser });
  await app.emit({ type: "extension_ui_request", id: "oauth", method: "open_url", url: "https://example.com/fallback", launchUrl: "https://example.com/oauth" });
  expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");
  await app.emit({ type: "extension_ui_request", id: "oauth-url", method: "open_url", url: "https://example.com/fallback" });
  expect(openExternal).toHaveBeenLastCalledWith("https://example.com/fallback");
  expect(openBrowser).not.toHaveBeenCalled();
  expect(app.container.querySelector("#web-browser-panel")).toBeNull();
});

it("扩展对话框内 Markdown 网页使用全局入口并显示延后提示，不关闭当前对话框", async () => {
  const app = await createAppFixture([]);
  const bridge = withBrowser(window.desktop);
  bridge.openExternal = vi.fn().mockResolvedValue(undefined);
  await app.emit({
    type: "extension_ui_request",
    id: "web-confirm",
    method: "confirm",
    title: "保留此对话框",
    message: "[对话框网页](https://example.com/dialog)",
  });
  const dialog = app.container.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("保留此对话框");
  const link = [...dialog!.querySelectorAll<HTMLAnchorElement>("a")].find((node) => node.textContent === "对话框网页");
  expect(link).toBeDefined();
  await app.click(link!);
  expect(bridge.openBrowser).toHaveBeenCalledWith("https://example.com/dialog");
  expect(bridge.openExternal).not.toHaveBeenCalled();
  expect(app.container.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog?.textContent).toContain("网页已在侧栏载入，关闭当前对话框后查看");
  expect(app.container.querySelector("#web-browser-panel")).not.toBeNull();
  expect(bridge.setBrowserLayout.mock.calls.every(([layout]) => !layout.visible)).toBe(true);
});
