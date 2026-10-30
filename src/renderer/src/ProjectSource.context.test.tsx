import { act } from "react";
import { expect, it, vi } from "vitest";
import { ProjectSource } from "./ProjectSource";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";
import { container, render } from "./transcript-test-harness";
import type { ProjectBrowser, ProjectReview } from "../../shared/project-browser";

it("源码当前行引用保留路径与原始 CRLF，刷新会关闭菜单", async () => {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectDirectory: vi.fn(), readProjectImage: vi.fn(), listProjectChanges: vi.fn(), readProjectDiff: vi.fn(),
    readProjectFile: vi.fn(async () => "first\r\nsecond\r\n"),
  };
  const actions = { comment: vi.fn<PromptContextActions["comment"]>(), append: vi.fn<PromptContextActions["append"]>() };
  const props = { file: { kind: "file" as const, name: "a.ts", path: "/project/a.ts" }, browser,
    changes: { kind: "plain" as const, root: "/project", base: null, files: [] }, mode: "source" as const, revision: 0, wrap: true, preview: false };
  await render(<PromptContexts.Provider value={actions}><ProjectSource {...props} /></PromptContexts.Provider>);
  const row = container.querySelectorAll(".file-code-row")[1];
  await act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "评论")!.click());
  expect(actions.comment.mock.calls[0][0]).toEqual({ kind: "file", path: "/project/a.ts", text: "second\r\n", startLine: 2, endLine: 2, representation: "source" });
  expect(actions.comment.mock.calls[0][3]).toEqual({ kind: "local", path: "/project/a.ts", view: "source", identity: "first\r\nsecond\r\n", startLine: 2, endLine: 2 });
  await act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await render(<PromptContexts.Provider value={actions}><ProjectSource {...props} revision={1} /></PromptContexts.Provider>);
  expect(document.body.querySelector('[aria-label="正文操作"]')).toBeNull();
});

it("Markdown 可见选区引用不伪造源码行号，无选择使用文件引用", async () => {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectDirectory: vi.fn(), readProjectImage: vi.fn(), listProjectChanges: vi.fn(), readProjectDiff: vi.fn(),
    readProjectFile: vi.fn(async () => "# 标题\n\n正文甲"),
  };
  const actions = { comment: vi.fn<PromptContextActions["comment"]>(), append: vi.fn<PromptContextActions["append"]>() };
  await render(<PromptContexts.Provider value={actions}><ProjectSource file={{ kind: "file", name: "a.md", path: "/project/a.md" }} browser={browser}
    changes={{ kind: "plain", root: "/project", base: null, files: [] }} mode="source" revision={0} wrap preview /></PromptContexts.Provider>);
  const heading = container.querySelector("h1")!;
  const range = document.createRange();
  range.selectNodeContents(heading);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(() => heading.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "评论")!.click());
  expect(actions.comment.mock.calls[0][0]).toEqual({ kind: "file", path: "/project/a.md", text: "标题", representation: "preview" });
  expect(actions.comment.mock.calls[0][3]).toMatchObject({ kind: "local", path: "/project/a.md", view: "preview", identity: "# 标题\n\n正文甲", text: "标题" });
  const anchor = actions.comment.mock.calls[0][3];
  expect(anchor?.kind === "local" && anchor.range?.toString()).toBe("标题");
  window.getSelection()!.removeAllRanges();
  await act(() => heading.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "评论")!.click());
  expect(actions.comment.mock.calls[1][0]).toEqual({ kind: "file", path: "/project/a.md", text: "", representation: "reference" });
});
