import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import type { ProjectBrowser, ProjectEntry, ProjectReview } from "../../shared/project-browser";
import type { LocalCommentRevealRequest } from "./local-comment-reveal";

// 变更页连续滚动下的评论定位：目标区块未加载、已折叠、不在变更列表中。
let frames: Map<number, FrameRequestCallback>, sequence: number;
/** 不触发任何回调：所有区块都停留在“离屏”，只有强制定位的区块会被读取。 */
class IdleObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  frames = new Map(); sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", IdleObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30, toJSON() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flushFrames() {
  for (let index = 0; index < 6; index++) {
    await act(async () => {
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(0);
    });
  }
}
const target: ProjectEntry = { name: "target.ts", path: "/project/src/target.ts", kind: "file", change: "modified" };
const other: ProjectEntry = { name: "other.ts", path: "/project/other.ts", kind: "file", change: "modified" };
const rows = [{ kind: "addition" as const, text: "added", ending: "\n", newLine: 1 }];

function fixture() {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: vi.fn<ProjectReview["listProjectChanges"]>(async () => ({ kind: "git", root: "/project", base: "base", files: [target, other] })),
    listProjectDirectory: vi.fn<ProjectBrowser["listProjectDirectory"]>(async () => []),
    readProjectFile: vi.fn(async () => ""),
    readProjectDiff: vi.fn(async () => ({ before: "", after: "added\n", rows })),
    readProjectImage: vi.fn(),
  };
  const request: LocalCommentRevealRequest = { requestId: "diff-1", entryId: "entry-1", file: target,
    sourceAnchor: { kind: "local", path: target.path, view: "diff", identity: JSON.stringify(rows), base: "base", side: "new", row: 0 } };
  return { browser, request, props: { cwd: "/project", browser, suspended: false, onClose: vi.fn(), onCommentReveal: vi.fn() } };
}
const section = (path: string) => container.querySelector<HTMLElement>(`[data-change-path="${path}"]`)!;

it("diff 定位在目标区块未加载时强制读取并成功定位，其它离屏区块不读取，占位不阻塞", async () => {
  const { browser, request, props } = fixture();
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  await flushFrames();
  expect(browser.readProjectDiff).toHaveBeenCalledTimes(1);
  expect(browser.readProjectDiff).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ path: target.path }) }));
  expect(section(other.path).querySelector(".change-section-placeholder")).not.toBeNull();
  expect(section(other.path).querySelector('[role="status"]')).toBeNull();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({
    requestId: "diff-1", status: "located",
    trigger: container.querySelector(`[data-change-path="${target.path}"] [data-diff-side="new"] [data-diff-index="0"]`),
  }));
  expect(browser.readProjectFile).not.toHaveBeenCalled();
});

it("diff 定位会展开已折叠的目标区块", async () => {
  const { browser, request, props } = fixture();
  await render(<CodeReviewPanel {...props} />);
  const changesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("变更"))!;
  await act(() => changesTab.click());
  await act(() => container.querySelector<HTMLButtonElement>('[aria-label="折叠文件差异 target.ts"]')!.click());
  expect(section(target.path).dataset.collapsed).toBe("true");
  expect(browser.readProjectDiff).not.toHaveBeenCalled();
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  await flushFrames();
  expect(section(target.path).dataset.collapsed).toBe("false");
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ requestId: "diff-1", status: "located" }));
});

it("diff 定位的文件不在当前变更列表时报告不可定位，且不读取差异", async () => {
  const { browser, request, props } = fixture();
  const missing = "/project/src/missing.ts";
  await render(<CodeReviewPanel {...props} commentReveal={{ ...request, requestId: "missing", file: { ...target, path: missing },
    sourceAnchor: { ...request.sourceAnchor, path: missing } }} />);
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ requestId: "missing", status: "unavailable" }));
  expect(browser.readProjectDiff).not.toHaveBeenCalled();
});

it("目标区块读取失败时报告不可定位并带上错误原因", async () => {
  const { browser, request, props } = fixture();
  browser.readProjectDiff = vi.fn(async () => { throw new Error("读取坏了"); });
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ requestId: "diff-1", status: "unavailable", reason: "读取坏了" }));
});
