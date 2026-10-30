import { createContext } from "react";
import type { LocalCommentAnchor, MarkdownCommentDescriptor } from "../../shared/comment-anchor";
import type { ProjectEntry } from "../../shared/project-browser";
import { sameProjectPath } from "../../shared/message-file-link";

export interface LocalCommentRevealRequest {
  requestId: string;
  entryId: string;
  file: ProjectEntry;
  sourceAnchor: LocalCommentAnchor;
}
export type LocalCommentRevealResult =
  | { requestId: string; status: "located"; screenAnchor: { x: number; y: number }; trigger: HTMLElement }
  | { requestId: string; status: "unavailable"; reason: string }
  | { requestId: string; status: "cancelled" };
export const LocalCommentReveal = createContext<{
  request?: LocalCommentRevealRequest;
  complete?: (result: LocalCommentRevealResult) => void;
}>({});

export interface LocalCommentSurface {
  path?: string;
  previousPath?: string;
  view: LocalCommentAnchor["view"];
  identity?: string;
  base?: string | null;
}
export interface ExactLocalTarget { trigger: HTMLElement; range?: Range }

/** Ignore changing image-loading labels and code-copy controls in preview identity. */
function markdownRenderedText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(".markdown-preview-image-note, .rich-source-toolbar"))
      parts.push(node.textContent ?? "");
  }
  return parts.join("");
}

/** Capture child-node coordinates, not a text-search hint. */
export function describeMarkdownRange(root: HTMLElement, range: Range): MarkdownCommentDescriptor | undefined {
  const endpoint = (node: Node, offset: number) => {
    const path: number[] = [];
    while (node !== root) {
      const parent = node.parentNode;
      if (!parent) return undefined;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return { path, offset };
  };
  const start = endpoint(range.startContainer, range.startOffset);
  const end = endpoint(range.endContainer, range.endOffset);
  return start && end ? { version: 1, renderedText: markdownRenderedText(root), start, end } : undefined;
}

function previewRange(root: HTMLElement, anchor: LocalCommentAnchor): Range | undefined {
  const valid = (range: Range) => range.startContainer.isConnected && range.endContainer.isConnected &&
    root.contains(range.startContainer) && root.contains(range.endContainer) && range.toString() === anchor.text;
  if (anchor.range && valid(anchor.range)) return anchor.range;
  const descriptor = anchor.markdown;
  if (!descriptor || descriptor.version !== 1 || descriptor.renderedText !== markdownRenderedText(root)) return;
  const endpoint = (point: MarkdownCommentDescriptor["start"]) => {
    let node: Node = root;
    for (const index of point.path) {
      if (!Number.isInteger(index) || index < 0 || !node.childNodes[index]) return;
      node = node.childNodes[index];
    }
    const length = node.nodeType === Node.TEXT_NODE ? node.textContent?.length ?? 0 : node.childNodes.length;
    if (!Number.isInteger(point.offset) || point.offset < 0 || point.offset > length) return;
    return node;
  };
  const start = endpoint(descriptor.start), end = endpoint(descriptor.end);
  if (!start || !end) return;
  try {
    const range = root.ownerDocument.createRange();
    range.setStart(start, descriptor.start.offset);
    range.setEnd(end, descriptor.end.offset);
    return valid(range) ? range : undefined;
  } catch { return; }
}

/** Both badges and pencil reveal use these same exact identity checks. */
export function resolveLocalCommentTarget(root: HTMLElement, surface: LocalCommentSurface, anchor: LocalCommentAnchor): ExactLocalTarget | undefined {
  if (anchor.view !== surface.view || (surface.path !== undefined && !sameProjectPath(anchor.path, surface.path))) return;
  if (anchor.view !== "path" && (anchor.identity === undefined || anchor.identity !== surface.identity)) return;
  if (anchor.view === "diff" && (anchor.base !== surface.base || anchor.previousPath !== surface.previousPath)) return;
  if (anchor.view === "preview") {
    const range = previewRange(root, anchor);
    return range ? { trigger: root, range } : undefined;
  }
  if (anchor.view === "path") {
    const trigger = [...root.querySelectorAll<HTMLElement>("[data-project-path]")].find(node => sameProjectPath(node.dataset.projectPath ?? "", anchor.path));
    return trigger ? { trigger } : undefined;
  }
  if (anchor.view === "diff") {
    const selector = anchor.row === undefined ? ".project-diff-summary" : `[data-diff-index="${anchor.row}"]`;
    const trigger = [...root.querySelectorAll<HTMLElement>(selector)].find(node => {
      const side = node.closest<HTMLElement>("[data-diff-side]")?.dataset.diffSide;
      return anchor.row === undefined || !anchor.side || side === "unified" || side === anchor.side;
    });
    return trigger ? { trigger } : undefined;
  }
  if (anchor.startLine === undefined) return { trigger: root };
  const row = root.querySelector<HTMLElement>(`.file-code-gutter[data-line="${anchor.startLine}"]`)?.closest<HTMLElement>(".file-code-row");
  if (row) return { trigger: row };
  const tail = root.querySelector<HTMLElement>(".file-code-tail"), node = tail?.firstChild;
  if (!tail || node?.nodeType !== Node.TEXT_NODE || surface.identity === undefined) return;
  let line = 1, offset = 0;
  while (line < anchor.startLine && offset < surface.identity.length) {
    const character = surface.identity[offset++];
    if (character === "\r") { if (surface.identity[offset] === "\n") offset++; line++; }
    else if (character === "\n") line++;
  }
  const local = offset - Number(tail.dataset.sourceOffset);
  if (line !== anchor.startLine || local < 0 || local >= (node.textContent?.length ?? 0)) return;
  const range = root.ownerDocument.createRange();
  range.setStart(node, local); range.setEnd(node, local + 1);
  return { trigger: tail, range };
}

export function localTargetRect(target: ExactLocalTarget): DOMRect {
  return target.range?.getBoundingClientRect() ?? target.trigger.getBoundingClientRect();
}

/** Scroll the actual selected range through every clipping scroll ancestor. */
export function scrollLocalCommentTarget(target: ExactLocalTarget): void {
  if (!target.range) { target.trigger.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" }); return; }
  let element = target.range.startContainer.nodeType === Node.ELEMENT_NODE
    ? target.range.startContainer as HTMLElement : target.range.startContainer.parentElement;
  for (; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (!/(auto|scroll|hidden)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
    const rect = localTargetRect(target), clip = element.getBoundingClientRect();
    if (rect.top < clip.top || rect.bottom > clip.bottom) element.scrollTop += rect.top - clip.top - Math.max(0, (clip.height - rect.height) / 2);
    if (rect.left < clip.left || rect.right > clip.right) element.scrollLeft += rect.left - clip.left;
  }
}
