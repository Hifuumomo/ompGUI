import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { ProjectFiles } from "./ProjectFiles";
import type { ProjectBrowser, ProjectDiff, ProjectEntry, ProjectReview } from "../../shared/project-browser";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";

const entry: ProjectEntry = {
  name: "a#%.ts",
  path: "/project/deep/a#%.ts",
  kind: "file",
  change: "modified",
};

/** 创建树和安全文件接口的测试输入。参数：无。返回值：侧栏属性与接口桩。 */
function fixture() {
  const desktop = {
    resolveProjectFileLink: vi.fn(async () => entry),
    listFileOpeners: vi.fn(async () => []),
    runFileAction: vi.fn(async () => {}),
  };
  vi.stubGlobal("desktop", desktop);
  const browser: ProjectBrowser & ProjectReview = {
    listProjectDirectory: vi.fn(async () => [entry]),
    readProjectFile: vi.fn(),
    readProjectImage: vi.fn(),
    listProjectChanges: vi.fn(),
    readProjectDiff: vi.fn(async () => ({ before: "old\n", after: "new\n", rows: [
      { kind: "deletion" as const, text: "old", ending: "\n", oldLine: 1 },
      { kind: "addition" as const, text: "new", ending: "\n", newLine: 1 },
    ] })),
  };
  return {
    desktop,
    props: {
      root: "/project",
      browser,
      changes: { kind: "git" as const, root: "/project", base: "base", files: [entry] },
      revision: 0,
      onSelect: vi.fn(),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());


it("键盘菜单支持 Escape 返回文件焦点，根目录切换丢弃迟到解析", async () => {
  const { props, desktop } = fixture();
  await render(<ProjectFiles {...props} />);
  const row = container.querySelector<HTMLButtonElement>('[aria-label="查看文件 a#%.ts"]')!;
  await act(() => {
    row.focus();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
  });
  await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(row);
  const pending = Promise.withResolvers<ProjectEntry>();
  desktop.resolveProjectFileLink.mockImplementationOnce(() => pending.promise);
  await act(() => row.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true })));
  await render(<ProjectFiles {...props} root="/another" />);
  await act(() => pending.resolve(entry));
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
});

it("不可访问的变更文件显示解析错误而不是打开旧菜单", async () => {
  const { props, desktop } = fixture();
  desktop.resolveProjectFileLink.mockRejectedValueOnce(new Error("路径不存在或无法访问"));
  await render(<ProjectFiles {...props} />);
  await act(() => container.querySelector('[aria-label="查看文件 a#%.ts"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("路径不存在或无法访问");
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
});

it("删除文件评论只引用路径，完整差异保留原始行并使用 Git 元数据", async () => {
  const { props, desktop } = fixture();
  const deleted = { ...entry, change: "deleted" as const };
  const actions = { comment: vi.fn<PromptContextActions["comment"]>(), append: vi.fn<PromptContextActions["append"]>() };
  await render(<PromptContexts.Provider value={actions}><ProjectFiles {...props} changes={{ ...props.changes, files: [deleted] }} /></PromptContexts.Provider>);
  const open = async () => act(() => container.querySelector('[aria-label="查看文件 a#%.ts"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  const click = async (label: string) => act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === label)!.click());
  await open();
  expect(desktop.resolveProjectFileLink).toHaveBeenLastCalledWith(expect.any(String), "/project", true);
  await click("评论文件");
  expect(actions.comment.mock.calls[0][0]).toEqual({ kind: "file", path: entry.path, text: "", representation: "reference" });
  expect(actions.comment.mock.calls[0][3]).toEqual({ kind: "local", view: "path", path: entry.path });
  await open();
  await click("添加 Git diff 到提示词");
  expect(props.browser.readProjectDiff).toHaveBeenCalledWith({ cwd: "/project", base: "base", file: deleted });
  expect(actions.append.mock.calls[0][0]).toMatchObject({ kind: "diff", path: entry.path, base: "base", side: "unified", rows: [{ oldLine: 1, text: "old" }, { newLine: 1, text: "new" }] });
});

it("差异读取切换后失效，超限错误留在原菜单且不追加", async () => {
  const { props } = fixture();
  const actions: PromptContextActions = { comment: vi.fn(), append: vi.fn() };
  const pending = Promise.withResolvers<ProjectDiff>();
  vi.mocked(props.browser.readProjectDiff).mockImplementationOnce(() => pending.promise);
  const view = (revision: number) => <PromptContexts.Provider value={actions}><ProjectFiles {...props} revision={revision} /></PromptContexts.Provider>;
  const open = async () => act(() => container.querySelector('[aria-label="查看文件 a#%.ts"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  const add = async () => act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "添加 Git diff 到提示词")!.click());
  await render(view(0));
  await open();
  await add();
  await render(view(1));
  await act(() => pending.resolve({ before: "", after: "late", rows: [{ kind: "addition", text: "late", ending: "", newLine: 1 }] }));
  expect(actions.append).not.toHaveBeenCalled();
  vi.mocked(props.browser.readProjectDiff).mockResolvedValueOnce({ before: "", after: "", rows: [{ kind: "addition", text: "长".repeat(65537), ending: "", newLine: 1 }] });
  await open();
  await add();
  expect(document.body.querySelector('[role="menu"] [role="alert"]')?.textContent).toContain("差异过长");
  expect(actions.append).not.toHaveBeenCalled();
});
