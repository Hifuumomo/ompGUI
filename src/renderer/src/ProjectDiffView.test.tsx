import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDiff } from "../../shared/project-browser";
import type { PromptContext } from "../../shared/prompt-context";
import { ProjectDiffView } from "./ProjectDiffView";
import { PromptContexts } from "./PromptContexts";
import { click, container, render } from "./transcript-test-harness";

const diff: ProjectDiff = {
  before: "const same = 1;\r\nconst same = 1;",
  after: "const same = 1;\n",
  rows: [
    { kind: "deletion", text: "const same = 1;", ending: "\r\n", oldLine: 1 },
    { kind: "deletion", text: "const same = 1;", ending: "", oldLine: 2 },
    { kind: "addition", text: "const same = 1;", ending: "\n", newLine: 1 },
  ],
};
const append = vi.fn<(context: PromptContext) => void>();
const comment = vi.fn();
const copyText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  append.mockReset();
  comment.mockReset();
  copyText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("desktop", { copyText });
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

async function show(value = diff, mode: "split" | "unified" = "split") {
  await render(<PromptContexts.Provider value={{ append, comment }}>
    <ProjectDiffView diff={value} path="next.ts" previousPath="before.ts" base="abc123" mode={mode} wrap />
  </PromptContexts.Provider>);
}
function row(side: "old" | "new" | "unified", index: number): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-diff-side="${side}"] [data-diff-index="${index}"]`)!;
}
async function contextMenu(target: HTMLElement) {
  await act(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })); });
}
function menuButton(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === label)!;
}
function select(start: Element, end: Element, endOffset: number) {
  const range = document.createRange();
  range.setStart(document.createTreeWalker(start, NodeFilter.SHOW_TEXT).nextNode()!, 0);
  range.setEnd(document.createTreeWalker(end, NodeFilter.SHOW_TEXT).nextNode()!, endOffset);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

it.each(["old", "new"] as const)("按 %s 侧原始对象识别重复文本，保留复制和差异元数据", async side => {
  await show();
  const index = side === "old" ? 1 : 2;
  const target = row(side, index);
  await contextMenu(target.querySelector<HTMLElement>(".project-diff-number")!);
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 1 行");
  await click(menuButton("复制"));
  expect(copyText).toHaveBeenCalledWith(diff.rows[index].text + diff.rows[index].ending);
  await contextMenu(target);
  await click(menuButton("添加到提示词"));
  const context = append.mock.calls[0][0];
  expect(context).toMatchObject({ kind: "diff", path: "next.ts", previousPath: "before.ts", base: "abc123", side, rows: diff.rows });
  if (context.kind !== "diff") throw new Error("预期差异上下文");
  // 提示词发送整个连续变更块，行对象仍是原始引用。
  expect(context.rows).toHaveLength(3);
  expect(context.rows[index]).toBe(diff.rows[index]);
  expect(copyText.mock.calls[0][0]).not.toContain("无末尾换行");
});

it("嵌套 token 的结束 offset 0 不包含下一行", async () => {
  await show();
  const first = row("old", 0).querySelector(".project-diff-text")!;
  const next = row("old", 1).querySelector(".project-diff-text")!;
  expect(next.querySelector("span")).not.toBeNull();
  select(first, next, 0);
  await contextMenu(row("old", 0));
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 1 行");
  await click(menuButton("添加到提示词"));
  const context = append.mock.calls[0][0];
  expect(context).toMatchObject({ kind: "diff", side: "old", rows: diff.rows });
});

it("跨侧选择显示错误，空白配对不打开菜单", async () => {
  await show();
  select(row("old", 0).querySelector(".project-diff-text")!, row("new", 2).querySelector(".project-diff-text")!, 1);
  await contextMenu(row("old", 0));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("不能跨侧选择");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  window.getSelection()!.removeAllRanges();
  await contextMenu(container.querySelector<HTMLElement>(".project-diff-cell.gap")!);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("摘要引用整个原始差异，切换模式清除菜单", async () => {
  await show();
  await contextMenu(container.querySelector<HTMLElement>(".project-diff-summary")!);
  expect(container.textContent).toContain("整个文件差异");
  expect(document.querySelector('[role="menu"] .context-actions-title')?.textContent).toBe("整个文件差异");
  await click(menuButton("添加到提示词"));
  const context = append.mock.calls[0][0];
  if (context.kind !== "diff") throw new Error("预期差异上下文");
  expect(context.side).toBe("unified");
  expect(context.rows).toBe(diff.rows);
  await contextMenu(row("old", 0));
  await show(diff, "unified");
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("单一容器 tabstop 支持键盘聚焦行及整份差异", async () => {
  await show();
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  const target = row("new", 2);
  await act(() => { target.focus(); target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true })); });
  await click(menuButton("添加到提示词"));
  expect(append.mock.calls[0][0]).toMatchObject({ side: "new", rows: diff.rows });
  const root = container.querySelector<HTMLElement>(".project-diff-view")!;
  await act(() => { root.focus(); root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" })); });
  await click(menuButton("添加到提示词"));
  const context = append.mock.calls[1][0];
  if (context.kind !== "diff") throw new Error("预期差异上下文");
  expect(context.rows).toBe(diff.rows);
});

it("过大上下文显示错误而不打开菜单", async () => {
  // 多个常规长度的行验证整份引用总上限，避免把边界测试变成长 token 高亮压力测试。
  await show({ before: "", after: "", rows: Array.from({ length: 128 }, (_, index) => ({
    kind: "addition" as const, text: "x ".repeat(256), ending: "\n", newLine: index + 1,
  })) });
  await contextMenu(container.querySelector<HTMLElement>(".project-diff-summary")!);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("所选内容过长");
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

const mixed: ProjectDiff = {
  before: "前\n旧\n后\n",
  after: "前\n新\n后\n",
  rows: [
    { kind: "context", text: "前", ending: "\n", oldLine: 1, newLine: 1 },
    { kind: "deletion", text: "旧", ending: "\n", oldLine: 2 },
    { kind: "addition", text: "新", ending: "\n", newLine: 2 },
    { kind: "context", text: "后", ending: "\n", oldLine: 3, newLine: 3 },
  ],
};

it.each(["右键单行", "框选"])("split 右栏选中新增行时提示词含相邻删除行，复制、锚点和行数仍只针对选中行：%s", async how => {
  await show(mixed);
  const target = row("new", 2);
  if (how === "框选") {
    const text = target.querySelector(".project-diff-text")!;
    select(text, text, 1);
  }
  const open = () => contextMenu(target);
  await open();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 1 行");
  await click(menuButton("复制"));
  expect(copyText).toHaveBeenCalledWith("新\n");
  await open();
  await click(menuButton("评论"));
  const [context, , , sourceAnchor] = comment.mock.calls[0];
  if (context.kind !== "diff") throw new Error("预期差异上下文");
  expect(context.rows).toEqual(mixed.rows.slice(1, 3));
  expect(context.rows[0]).toBe(mixed.rows[1]);
  expect(context.side).toBe("new");
  expect(sourceAnchor).toMatchObject({ kind: "local", view: "diff", side: "new", row: 2 });
});

it("变更块扩展后超过上限时显示错误而不打开菜单", async () => {
  // 单独选中其中一行不超限，扩展到整个变更块后才超限。
  await show({ before: "", after: "", rows: [
    { kind: "context" as const, text: "前", ending: "\n", oldLine: 1, newLine: 1 },
    ...Array.from({ length: 128 }, (_, index) => ({ kind: "addition" as const, text: "x ".repeat(256), ending: "\n", newLine: index + 2 })),
  ] });
  await contextMenu(row("new", 1));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("所选内容过长");
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("没有草稿 provider 时只显示复制操作", async () => {
  await render(<ProjectDiffView diff={diff} path="next.ts" base={null} mode="split" wrap />);
  await contextMenu(row("old", 0));
  const buttons = [...document.querySelectorAll('[role="menu"] button')];
  expect(buttons.map(button => button.textContent)).toEqual(["复制"]);
});
