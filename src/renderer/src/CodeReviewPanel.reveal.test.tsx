import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import type { ProjectBrowser, ProjectEntry, ProjectReview } from "../../shared/project-browser";
import type { LocalCommentRevealRequest } from "./local-comment-reveal";
import { describeMarkdownRange } from "./local-comment-reveal";

let frames: Map<number, FrameRequestCallback>, sequence: number;
const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
beforeEach(() => {
  frames = new Map(); sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30, toJSON() {} });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 50, width: 400, height: 30 }) });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalRangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeRect);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
async function flushFrames() {
  for (let index = 0; index < 6; index++) {
    await act(async () => {
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(0);
    });
  }
}
const file: ProjectEntry = { name: "a.ts", path: "/project/src/a.ts", kind: "file" };
function fixture() {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: vi.fn<ProjectReview["listProjectChanges"]>(async () => ({ kind: "plain", root: "/project", base: null, files: [] })),
    listProjectDirectory: vi.fn<ProjectBrowser["listProjectDirectory"]>(async (path) => path === "/project" ? [{ name: "src", path: "/project/src", kind: "directory" }] : [file]),
    readProjectFile: vi.fn(async () => "first\nsecond\n"), readProjectDiff: vi.fn(), readProjectImage: vi.fn(),
  };
  const request: LocalCommentRevealRequest = { requestId: "reveal-1", entryId: "entry-1", file,
    sourceAnchor: { kind: "local", path: file.path, view: "source", identity: "first\nsecond\n", startLine: 2 } };
  return { browser, request, props: { cwd: "/project", browser, suspended: false, onClose: vi.fn(), onCommentReveal: vi.fn() } };
}

it("reveals the actual source line and reuses a mounted source without refreshing it", async () => {
  const { browser, request, props } = fixture();
  await render(<CodeReviewPanel {...props} requestedFile={file} />);
  expect(browser.readProjectFile).toHaveBeenCalledTimes(1);
  const line = container.querySelector('[data-line="2"]')?.closest(".file-code-row");
  const scroll = vi.fn(); Object.defineProperty(line!, "scrollIntoView", { configurable: true, value: scroll });
  await render(<CodeReviewPanel {...props} requestedFile={file} commentReveal={request} />);
  await flushFrames();
  expect(browser.readProjectFile).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ requestId: request.requestId, status: "located", trigger: line, screenAnchor: { x: 10, y: 20 } }));
});

it("does not scroll or complete a cleared request after an outstanding source read", async () => {
  const { browser, request, props } = fixture();
  const deferred = Promise.withResolvers<string>();
  browser.readProjectFile = vi.fn(() => deferred.promise);
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  await render(<CodeReviewPanel {...props} />);
  await act(() => deferred.resolve("first\nsecond\n"));
  await flushFrames();
  expect(props.onCommentReveal).not.toHaveBeenCalled();
});

it("explicit file navigation cancels rather than opening a stale fallback editor", async () => {
  const { browser, request, props } = fixture();
  const deferred = Promise.withResolvers<string>();
  browser.readProjectFile = vi.fn(() => deferred.promise);
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  const button = container.querySelector<HTMLButtonElement>('[data-project-path="/project/src/a.ts"]');
  expect(button).not.toBeNull();
  await act(() => button!.click());
  expect(props.onCommentReveal).toHaveBeenCalledWith({ requestId: request.requestId, status: "cancelled" });
  await act(() => deferred.resolve("first\nsecond\n"));
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenCalledTimes(1);
});

it("path-only reveal expands ancestors, clears filters and never reads file contents", async () => {
  const { browser, request, props } = fixture();
  const pathRequest = { ...request, sourceAnchor: { ...request.sourceAnchor, view: "path" as const } };
  await render(<CodeReviewPanel {...props} commentReveal={pathRequest} />);
  await flushFrames();
  expect(browser.readProjectFile).not.toHaveBeenCalled();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ status: "located", trigger: container.querySelector('[data-project-path="/project/src/a.ts"]') }));
  await render(<CodeReviewPanel {...props} />);
  await flushFrames();
  expect(browser.readProjectFile).not.toHaveBeenCalled();
});

it("changed source identity is unavailable instead of moving to a similar line", async () => {
  const { request, props } = fixture();
  await render(<CodeReviewPanel {...props} commentReveal={{ ...request, sourceAnchor: { ...request.sourceAnchor, identity: "old contents" } }} />);
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
});

it("keeps a matching mounted Markdown Range and reconstructs its exact descriptor after switching files", async () => {
  const { browser, props } = fixture();
  const markdown: ProjectEntry = { name: "a.md", path: "/project/a.md", kind: "file" };
  browser.readProjectFile = vi.fn(async (path) => path === markdown.path ? "first\n\nsecond\n\nsecond" : "other");
  await render(<CodeReviewPanel {...props} requestedFile={markdown} />);
  const root = container.querySelector<HTMLElement>(".markdown-preview")!.parentElement!;
  const paragraph = root.querySelectorAll("p")[2];
  const range = document.createRange(); range.selectNodeContents(paragraph);
  const request: LocalCommentRevealRequest = { requestId: "markdown-1", entryId: "markdown", file: markdown,
    sourceAnchor: { kind: "local", path: markdown.path, view: "preview", identity: "first\n\nsecond\n\nsecond",
      range, text: "second", markdown: describeMarkdownRange(root, range) } };
  await render(<CodeReviewPanel {...props} requestedFile={markdown} commentReveal={request} />);
  await flushFrames();
  expect(container.querySelectorAll(".markdown-preview p")[2]).toBe(paragraph);
  expect(range.startContainer.isConnected).toBe(true);
  expect(browser.readProjectFile).toHaveBeenCalledTimes(1);
  expect(props.onCommentReveal).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "markdown-1", status: "located" }));
  await render(<CodeReviewPanel {...props} requestedFile={file} />);
  expect(paragraph.isConnected).toBe(false);
  await render(<CodeReviewPanel {...props} requestedFile={file} commentReveal={{ ...request, requestId: "markdown-2" }} />);
  await flushFrames();
  expect(container.querySelectorAll(".markdown-preview p")[2]).not.toBe(paragraph);
  expect(props.onCommentReveal).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "markdown-2", status: "located" }));
});

it("opens old-side deleted-file diff directly in split view without reading a missing source", async () => {
  const { browser, request, props } = fixture();
  const deleted: ProjectEntry = { ...file, change: "deleted" };
  const rows = [{ kind: "deletion" as const, text: "removed", ending: "\n", oldLine: 1 }];
  browser.listProjectChanges = vi.fn<ProjectReview["listProjectChanges"]>(async () => ({ kind: "git", root: "/project", base: "base", files: [deleted] }));
  browser.readProjectDiff = vi.fn(async () => ({ before: "removed\n", after: "", rows }));
  await render(<CodeReviewPanel {...props} commentReveal={{ ...request, file: deleted, sourceAnchor: {
    kind: "local", path: file.path, view: "diff", identity: JSON.stringify(rows), base: "base", side: "old", row: 0,
  } }} />);
  await flushFrames();
  expect(browser.readProjectFile).not.toHaveBeenCalled();
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({
    status: "located", trigger: container.querySelector('[data-diff-side="old"] [data-diff-index="0"]'),
  }));
});

it("reveals an outside-project path through its own parent directory and reports a missing item without a source read", async () => {
  const { browser, request, props } = fixture();
  const outside: ProjectEntry = { name: "outside.ts", path: "/outside/outside.ts", kind: "file" };
  browser.listProjectDirectory = vi.fn(async () => [outside]);
  const pathRequest = { ...request, file: outside, sourceAnchor: { kind: "local" as const, path: outside.path, view: "path" as const } };
  await render(<CodeReviewPanel {...props} commentReveal={pathRequest} />);
  await flushFrames();
  expect(browser.listProjectDirectory).toHaveBeenCalledWith("/outside");
  expect(props.onCommentReveal).toHaveBeenLastCalledWith(expect.objectContaining({ status: "located" }));
  expect(browser.readProjectFile).not.toHaveBeenCalled();
  await render(<CodeReviewPanel {...props} commentReveal={{ ...pathRequest, requestId: "missing", file: { ...outside, path: "/outside/missing.ts" },
    sourceAnchor: { ...pathRequest.sourceAnchor, path: "/outside/missing.ts" } }} />);
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "missing", status: "unavailable" }));
  expect(browser.readProjectFile).not.toHaveBeenCalled();
});

it("only the newest request can scroll or complete when reads resolve out of order", async () => {
  const { browser, request, props } = fixture();
  const oldRead = Promise.withResolvers<string>(), newRead = Promise.withResolvers<string>();
  const newerFile: ProjectEntry = { name: "new.ts", path: "/project/new.ts", kind: "file" };
  browser.readProjectFile = vi.fn((path) => path === file.path ? oldRead.promise : newRead.promise);
  await render(<CodeReviewPanel {...props} commentReveal={request} />);
  const newer = { ...request, requestId: "newest", file: newerFile,
    sourceAnchor: { ...request.sourceAnchor, path: newerFile.path } };
  await render(<CodeReviewPanel {...props} commentReveal={newer} />);
  await act(() => oldRead.resolve("first\nsecond\n"));
  await flushFrames();
  expect(props.onCommentReveal).not.toHaveBeenCalled();
  await act(() => newRead.resolve("first\nsecond\n"));
  await flushFrames();
  expect(props.onCommentReveal).toHaveBeenCalledTimes(1);
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({ requestId: "newest", status: "located" }));
});

it("clears an active changed-file filter and expands a folded ancestor for a deleted path reference", async () => {
  const { browser, request, props } = fixture();
  const deleted: ProjectEntry = { ...file, change: "deleted" };
  browser.listProjectChanges = vi.fn<ProjectReview["listProjectChanges"]>(async () => ({ kind: "git", root: "/project", base: "base", files: [deleted] }));
  await render(<CodeReviewPanel {...props} />);
  const directory = container.querySelector<HTMLButtonElement>('[data-project-path="/project/src"]')!;
  await act(() => directory.click());
  const filter = container.querySelector<HTMLInputElement>('[aria-label="筛选变更文件"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(filter, "not-found");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[data-project-path="/project/src/a.ts"]')).toBeNull();
  await render(<CodeReviewPanel {...props} commentReveal={{ ...request, file: deleted, sourceAnchor: { kind: "local", path: deleted.path, view: "path" } }} />);
  await flushFrames();
  expect(filter.value).toBe("");
  expect(props.onCommentReveal).toHaveBeenCalledWith(expect.objectContaining({
    status: "located", trigger: container.querySelector('[data-project-path="/project/src/a.ts"]'),
  }));
  expect(browser.readProjectFile).not.toHaveBeenCalled();
});
