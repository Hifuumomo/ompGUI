import { afterEach, expect, it } from "vitest";
import type { LocalCommentAnchor } from "../../shared/comment-anchor";
import { describeMarkdownRange, resolveLocalCommentTarget, scrollLocalCommentTarget } from "./local-comment-reveal";

const roots: HTMLElement[] = [];
afterEach(() => { for (const root of roots.splice(0)) root.remove(); });
function surface(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}

it("reconstructs only the exact versioned Markdown node coordinates after remount, including UTF-16 offsets", () => {
  const first = surface("<article><p>same 😀 text</p><p>same 😀 text</p></article>");
  const range = document.createRange();
  const node = first.querySelectorAll("p")[1].firstChild!;
  range.setStart(node, 5); range.setEnd(node, 7);
  const anchor: LocalCommentAnchor = { kind: "local", view: "preview", path: "/a.md", identity: "source", range,
    markdown: describeMarkdownRange(first, range), text: "😀" };
  const identity = { view: "preview" as const, path: "/a.md", identity: "source" };
  expect(resolveLocalCommentTarget(first, identity, anchor)?.range).toBe(range);
  first.remove();
  const remount = surface("<article><p>same 😀 text</p><p>same 😀 text</p></article>");
  const restored = resolveLocalCommentTarget(remount, identity, anchor)?.range;
  expect(restored?.startContainer).toBe(remount.querySelectorAll("p")[1].firstChild);
  expect(restored?.toString()).toBe("😀");
  expect(resolveLocalCommentTarget(remount, { ...identity, identity: "changed" }, anchor)).toBeUndefined();
  expect(resolveLocalCommentTarget(remount, identity, { ...anchor, markdown: undefined })).toBeUndefined();
  remount.querySelectorAll("p")[1].innerHTML = "same <em>😀</em> text";
  expect(resolveLocalCommentTarget(remount, identity, anchor)).toBeUndefined();
  remount.innerHTML = "<article><p>different</p><p>same 😀 text</p></article>";
  expect(resolveLocalCommentTarget(remount, identity, anchor)).toBeUndefined();
});

it("preview identity excludes dynamic image and copy-control labels without searching for duplicate text", () => {
  const root = surface('<article><span class="markdown-preview-image-note">loading</span><div class="rich-source-toolbar">复制</div><p>selected</p></article>');
  const range = document.createRange();
  range.selectNodeContents(root.querySelector("p")!);
  const anchor: LocalCommentAnchor = { kind: "local", view: "preview", path: "/a.md", identity: "source", range,
    markdown: describeMarkdownRange(root, range), text: "selected" };
  const remount = surface('<article><img alt="image"><div class="rich-source-toolbar">已复制</div><p>selected</p></article>');
  root.remove();
  expect(resolveLocalCommentTarget(remount, { path: "/a.md", view: "preview", identity: "source" }, anchor)?.range?.toString()).toBe("selected");
});

it("resolves source tail by exact CRLF line offset without decorating or text searching", () => {
  const source = "one\r\nsame\r\nsame\r\n";
  const root = surface('<span class="file-code-tail" data-source-offset="5"></span>');
  root.firstChild!.textContent = source.slice(5);
  const anchor: LocalCommentAnchor = { kind: "local", view: "source", path: "/a.ts", identity: source, startLine: 3 };
  const target = resolveLocalCommentTarget(root, { path: "/a.ts", view: "source", identity: source }, anchor);
  expect(target?.range?.startOffset).toBe(6);
  expect(target?.range?.toString()).toBe("s");
  expect(resolveLocalCommentTarget(root, { path: "/a.ts", view: "source", identity: source + "x" }, anchor)).toBeUndefined();
});

it("keeps old/new diff rows, base and rename identities separate and whole-diff anchors on summary", () => {
  const root = surface('<div class="project-diff-summary"></div><div data-diff-side="old"><span data-diff-index="2">old</span></div><div data-diff-side="new"><span data-diff-index="2">new</span></div>');
  const anchor: LocalCommentAnchor = { kind: "local", view: "diff", path: "/new.ts", previousPath: "/old.ts", identity: "rows", base: "base", side: "old", row: 2 };
  const identity = { path: "/new.ts", previousPath: "/old.ts", view: "diff" as const, identity: "rows", base: "base" };
  expect(resolveLocalCommentTarget(root, identity, anchor)?.trigger.textContent).toBe("old");
  expect(resolveLocalCommentTarget(root, { ...identity, base: "new-base" }, anchor)).toBeUndefined();
  expect(resolveLocalCommentTarget(root, { ...identity, previousPath: "/other.ts" }, anchor)).toBeUndefined();
  expect(resolveLocalCommentTarget(root, identity, { ...anchor, row: undefined })?.trigger.className).toBe("project-diff-summary");
});

it("path identity uses explicit data rather than a misleading title", () => {
  const root = surface('<button title="/a.ts" data-project-path="/wrong.ts"></button><button title="display only" data-project-path="/a.ts"></button>');
  const anchor: LocalCommentAnchor = { kind: "local", view: "path", path: "/a.ts" };
  expect(resolveLocalCommentTarget(root, { view: "path" }, anchor)?.trigger).toBe(root.lastChild);
  expect(resolveLocalCommentTarget(root, { view: "path" }, { ...anchor, path: "/missing.ts" })).toBeUndefined();
});

it("scrolls the exact range inside a long parent rather than jumping to the parent top", () => {
  const root = surface('<div style="overflow:auto"><p>selected</p></div>');
  const scroller = root.firstElementChild as HTMLElement;
  scroller.getBoundingClientRect = () => ({ top: 10, bottom: 110, left: 0, right: 100, width: 100, height: 100 }) as DOMRect;
  const range = document.createRange();
  range.selectNodeContents(scroller.querySelector("p")!);
  range.getBoundingClientRect = () => ({ top: 410, bottom: 430, left: 0, right: 50, width: 50, height: 20 }) as DOMRect;
  scrollLocalCommentTarget({ trigger: root, range });
  expect(scroller.scrollTop).toBe(360);
});
