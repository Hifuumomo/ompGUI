import { act, useCallback, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDiff, ProjectDiffRow, ProjectEntry } from "../../shared/project-browser";
import type { PromptContext } from "../../shared/prompt-context";
import { LocalCommentMarkers, diffCommentIdentity, type LocalCommentEntry } from "./LocalCommentMarkers";
import { LocalCommentReveal, type LocalCommentRevealRequest } from "./local-comment-reveal";
import { ProjectDiffView } from "./ProjectDiffView";
import { PromptContexts } from "./PromptContexts";
import { click, container, render } from "./transcript-test-harness";

/**
 * 0-9 未修改，10 新增，11-20 未修改，21 删除，22-31 未修改。
 * 折叠结果：隐藏 0-6、14-17、25-31，对应灰条 start 为 0、14、25，行数 7、4、7。
 */
function makeDiff(): ProjectDiff {
  const rows: ProjectDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  const context = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      oldLine += 1;
      newLine += 1;
      rows.push({ kind: "context", text: `ctx ${rows.length}`, ending: "\n", oldLine, newLine });
    }
  };
  context(10);
  rows.push({ kind: "addition", text: "added", ending: "\n", newLine: ++newLine });
  context(10);
  rows.push({ kind: "deletion", text: "removed", ending: "\n", oldLine: ++oldLine });
  context(10);
  return { before: "", after: "", rows };
}
const diff = makeDiff();
const identity = diffCommentIdentity(diff.rows);
const VISIBLE = [7, 8, 9, 10, 11, 12, 13, 18, 19, 20, 21, 22, 23, 24];

const append = vi.fn<(context: PromptContext) => void>();
const comment = vi.fn();
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
beforeEach(() => {
  append.mockReset();
  comment.mockReset();
  frames = new Map();
  sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flushFrames() {
  for (let index = 0; index < 6; index++) {
    await act(async () => {
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(0);
    });
  }
}

/** 与 ChangeFileSection 相同的展开状态接线，使点击真实改变分段。 */
function Host({ value = diff, mode = "unified", initial = [] }: {
  readonly value?: ProjectDiff;
  readonly mode?: "split" | "unified";
  readonly initial?: readonly number[];
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(initial));
  const onExpand = useCallback((start: number) => setExpanded((old) => new Set(old).add(start)), []);
  const onCollapse = useCallback((start: number) => setExpanded((old) => {
    const next = new Set(old);
    next.delete(start);
    return next;
  }), []);
  return (
    <PromptContexts.Provider value={{ append, comment }}>
      <div className="code-review-changes-scroll">
        <ProjectDiffView diff={value} path="next.ts" previousPath="before.ts" base="abc123" mode={mode} wrap
          fold={{ expanded, onExpand, onCollapse }} />
      </div>
    </PromptContexts.Provider>
  );
}
const bars = () => [...container.querySelectorAll<HTMLElement>("button.project-diff-fold")];
const barTexts = () => bars().map((bar) => bar.textContent);
const topBar = (start: number) =>
  container.querySelector<HTMLButtonElement>(`button[data-fold-start="${start}"][data-fold-edge="top"]`)!;
const bottomBar = (start: number) =>
  container.querySelector<HTMLButtonElement>(`button[data-fold-start="${start}"][data-fold-edge="bottom"]`);
const indices = (side: string) =>
  [...container.querySelectorAll<HTMLElement>(`[data-diff-side="${side}"] [data-diff-index]`)]
    .map((element) => Number(element.dataset.diffIndex));
const row = (index: number, side = "unified") =>
  container.querySelector<HTMLElement>(`[data-diff-side="${side}"] [data-diff-index="${index}"]`)!;
async function contextMenu(target: HTMLElement) {
  await act(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })); });
}
function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}
const textNode = (element: Element) =>
  document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
const diffText = (index: number) => textNode(row(index).querySelector(".project-diff-text")!);

it("单栏：灰条数量和文字正确，隐藏行不在 DOM 中，可见行的行号与完整差异一致", async () => {
  await render(<Host />);
  expect(barTexts()).toEqual(["7 行未修改", "4 行未修改", "7 行未修改"]);
  expect(bars().map((bar) => bar.getAttribute("aria-label"))).toEqual(["展开 7 行未修改", "展开 4 行未修改", "展开 7 行未修改"]);
  expect(bars().every((bar) => bar.getAttribute("aria-expanded") === "false")).toBe(true);
  expect(indices("unified")).toEqual(VISIBLE);
  for (const cell of container.querySelectorAll<HTMLElement>(".project-diff-cell.unified")) {
    const source = diff.rows[Number(cell.dataset.diffIndex)];
    const [oldNumber, newNumber] = cell.querySelectorAll(".project-diff-number");
    expect(oldNumber.getAttribute("data-old-line")).toBe(source.oldLine === undefined ? null : String(source.oldLine));
    expect(newNumber.getAttribute("data-new-line")).toBe(source.newLine === undefined ? null : String(source.newLine));
  }
});

it("并排：配对数和 --diff-row-count 正确，两侧灰条数量相同，右侧是不可聚焦的 aria-hidden div", async () => {
  await render(<Host mode="split" />);
  // 14 个配对 + 3 个灰条 + 1 个标题行。
  expect(container.querySelector<HTMLElement>(".project-diff-split")!.style.getPropertyValue("--diff-row-count")).toBe("18");
  const [oldPane, newPane] = [...container.querySelectorAll<HTMLElement>(".project-diff-pane")];
  expect(oldPane.children).toHaveLength(newPane.children.length);
  expect(oldPane.querySelectorAll("button.project-diff-fold")).toHaveLength(3);
  const mirrors = [...newPane.querySelectorAll<HTMLElement>(".project-diff-fold")];
  expect(mirrors).toHaveLength(3);
  for (const mirror of mirrors) {
    expect(mirror.tagName).toBe("DIV");
    expect(mirror.getAttribute("aria-hidden")).toBe("true");
    expect(mirror.hasAttribute("tabindex")).toBe(false);
    expect(mirror.textContent).toBe("");
  }
  expect(newPane.querySelectorAll("button")).toHaveLength(0);
  expect(indices("old")).toEqual(VISIBLE.filter((index) => index !== 10));
  expect(indices("new")).toEqual(VISIBLE.filter((index) => index !== 21));
  for (const cell of container.querySelectorAll<HTMLElement>("[data-diff-side=\"new\"] [data-diff-index]")) {
    expect(cell.dataset.line).toBe(String(diff.rows[Number(cell.dataset.diffIndex)].newLine));
  }
});

it("不传 fold 时没有灰条，全部行都在", async () => {
  await render(<ProjectDiffView diff={diff} path="next.ts" base="abc123" mode="unified" wrap />);
  expect(container.querySelector(".project-diff-fold")).toBeNull();
  expect(indices("unified")).toEqual(diff.rows.map((_, index) => index));
});

it("点击灰条原位展开，上方收起条保持同一个元素和焦点，只收起这一段", async () => {
  await render(<Host />);
  const bar = topBar(0);
  await click(bar);
  expect(topBar(0)).toBe(bar);
  expect(document.activeElement).toBe(bar);
  expect(bar.textContent).toBe("收起 7 行未修改");
  expect(bar.getAttribute("aria-expanded")).toBe("true");
  expect(bar.getAttribute("aria-label")).toBe("收起 7 行未修改");
  expect(bottomBar(0)?.textContent).toBe("收起 7 行未修改");
  expect(indices("unified")).toEqual([0, 1, 2, 3, 4, 5, 6, ...VISIBLE]);
  // 其他段不受影响。
  expect(topBar(14).getAttribute("aria-expanded")).toBe("false");
  expect(topBar(25).getAttribute("aria-expanded")).toBe("false");
  await click(bar);
  expect(topBar(0)).toBe(bar);
  expect(document.activeElement).toBe(bar);
  expect(bar.textContent).toBe("7 行未修改");
  expect(bottomBar(0)).toBeNull();
  expect(indices("unified")).toEqual(VISIBLE);
});

it("点击下方收起条只收起这一段，焦点移到灰条，并按位置差调整滚动", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    // 下方收起条在 300，收起后灰条出现在 120。
    const top = this.dataset.foldEdge === "bottom" ? 300 : this.dataset.foldEdge === "top" ? 120 : 0;
    return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 28, width: 100, height: 28, toJSON() {} };
  });
  await render(<Host initial={[0, 14]} />);
  const scroller = container.querySelector<HTMLElement>(".code-review-changes-scroll")!;
  let scrollTop = 500;
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
  await click(bottomBar(0)!);
  expect(topBar(0).getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(topBar(0));
  expect(scrollTop).toBe(500 + (120 - 300));
  expect(topBar(14).getAttribute("aria-expanded")).toBe("true");
});

it("并排：点右侧 div 与点左侧效果相同，焦点落在左侧按钮", async () => {
  await render(<Host mode="split" />);
  const mirror = (start: number, edge: string) =>
    container.querySelector<HTMLElement>(`div.project-diff-fold[data-fold-start="${start}"][data-fold-edge="${edge}"]`)!;
  await click(mirror(14, "top"));
  expect(topBar(14).getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(topBar(14));
  expect(indices("old")).toContain(15);
  expect(container.querySelectorAll("div.project-diff-fold[data-fold-edge=\"bottom\"]")).toHaveLength(1);
  await click(mirror(14, "bottom"));
  expect(topBar(14).getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(topBar(14));
  expect(indices("old")).not.toContain(15);
});

it("选区跨过灰条时报错且不打开菜单", async () => {
  await render(<Host />);
  select(diffText(12), 0, diffText(18), 1);
  await contextMenu(row(12));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("选区跨过了折叠的未修改行");
  expect(container.querySelector('[role="alert"]')?.textContent).not.toContain("不能跨侧选择");
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("结尾端点在灰条后一行的开头时不算跨越", async () => {
  await render(<Host />);
  select(diffText(12), 0, diffText(18), 0);
  await contextMenu(row(12));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 2 行");
});

it("灰条两侧各自选择正常；端点落在灰条上不再显示不能跨侧选择", async () => {
  await render(<Host />);
  select(diffText(8), 0, diffText(9), 1);
  await contextMenu(row(8));
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 2 行");
  window.getSelection()!.removeAllRanges();
  select(diffText(13), 0, textNode(topBar(14)), 1);
  await contextMenu(row(13));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 1 行");
});

it("跨过收起条的选区正常，右键灰条和键盘菜单键不打开错误提示", async () => {
  await render(<Host initial={[14]} />);
  select(diffText(12), 0, diffText(18), 1);
  await contextMenu(row(12));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("已选 7 行");
  window.getSelection()!.removeAllRanges();
  await contextMenu(topBar(0));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  // 键盘菜单键在灰条聚焦时与右键摘要行一致，针对整个文件差异。
  await act(() => {
    topBar(0).focus();
    topBar(0).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" }));
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="menu"] .context-actions-title')?.textContent).toBe("整个文件差异");
});

function entry(row: number, anchorIdentity = identity): LocalCommentEntry {
  return {
    id: `entry-${row}`, number: 1,
    context: { kind: "diff", path: "next.ts", base: "abc123", side: "new", rows: [] } as unknown as LocalCommentEntry["context"],
    sourceAnchor: { kind: "local", view: "diff", path: "next.ts", previousPath: "before.ts", base: "abc123", identity: anchorIdentity, side: "new", row },
  };
}

it("含评论的段保持展开且没有收起条，评论标记显示", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30, toJSON() {} });
  await render(<LocalCommentMarkers.Provider value={{ entries: [entry(15)], edit: vi.fn() }}><Host /></LocalCommentMarkers.Provider>);
  expect(barTexts()).toEqual(["7 行未修改", "7 行未修改"]);
  expect(bottomBar(14)).toBeNull();
  expect(indices("unified")).toEqual([...VISIBLE.slice(0, 7), 14, 15, 16, 17, ...VISIBLE.slice(7)]);
  expect(document.querySelector(".local-comment-marker")?.getAttribute("aria-label")).toBe("编辑评论1");
});

it("identity 不同的评论不影响折叠", async () => {
  await render(<LocalCommentMarkers.Provider value={{ entries: [entry(15, "旧内容")], edit: vi.fn() }}><Host /></LocalCommentMarkers.Provider>);
  expect(barTexts()).toEqual(["7 行未修改", "4 行未修改", "7 行未修改"]);
});

function revealRequest(anchorIdentity = identity): LocalCommentRevealRequest {
  const file: ProjectEntry = { name: "next.ts", path: "next.ts", kind: "file", change: "modified" };
  return { requestId: "r1", entryId: "entry-15", file, sourceAnchor: entry(15, anchorIdentity).sourceAnchor as LocalCommentRevealRequest["sourceAnchor"] };
}
function Revealing({ request, complete }: {
  readonly request?: LocalCommentRevealRequest;
  readonly complete: () => void;
}) {
  return <LocalCommentReveal.Provider value={{ request, complete }}><Host /></LocalCommentReveal.Provider>;
}

it("定位到折叠段内的行：报告 located，请求清除后这一段仍然展开且 trigger 仍连接", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30, toJSON() {} });
  const complete = vi.fn();
  await render(<Revealing request={revealRequest()} complete={complete} />);
  await flushFrames();
  const trigger = row(15);
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", status: "located", trigger }));
  await render(<Revealing complete={complete} />);
  await flushFrames();
  expect(row(15)).toBe(trigger);
  expect(trigger.isConnected).toBe(true);
  expect(topBar(14).getAttribute("aria-expanded")).toBe("true");
  expect(bottomBar(14)).not.toBeNull();
});

it("定位请求的 identity 不匹配时报告 unavailable，不展开", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30, toJSON() {} });
  const complete = vi.fn();
  await render(<Revealing request={revealRequest("旧内容")} complete={complete} />);
  await flushFrames();
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ requestId: "r1", status: "unavailable" }));
  expect(barTexts()).toEqual(["7 行未修改", "4 行未修改", "7 行未修改"]);
  expect(topBar(14).getAttribute("aria-expanded")).toBe("false");
});
