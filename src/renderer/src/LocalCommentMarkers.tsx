import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CommentSourceAnchor, LocalCommentAnchor } from "../../shared/comment-anchor";
import type { PromptContext } from "../../shared/prompt-context";
import "./local-comment-markers.css";
import { LocalCommentReveal, localTargetRect, resolveLocalCommentTarget, scrollLocalCommentTarget } from "./local-comment-reveal";
import { sameProjectPath } from "../../shared/message-file-link";

export interface LocalCommentEntry {
  id: string;
  number: number;
  context: PromptContext;
  sourceAnchor?: CommentSourceAnchor;
}
export const LocalCommentMarkers = createContext<{
  entries: readonly LocalCommentEntry[];
  edit: (id: string, anchor: { x: number; y: number }, trigger?: HTMLElement) => void;
}>({ entries: [], edit: () => {} });

/** 使用完整有界源文作为身份，不以相似文本搜索重绑来源。 */
export function diffCommentIdentity(rows: readonly unknown[]): string {
  return JSON.stringify(rows);
}

interface Props {
  root: RefObject<HTMLElement | null>;
  path?: string;
  previousPath?: string;
  view: LocalCommentAnchor["view"];
  identity?: string;
  base?: string | null;
}
interface Placement { entry: LocalCommentEntry; left: number; top: number; trigger: HTMLElement }

/** 标记位于宿主 portal，不进入源码/Markdown 文本或改变其选区与布局。 */
export function LocalSourceMarkers({ root, path, previousPath, view, identity, base }: Props) {
  const registry = useContext(LocalCommentMarkers);
  const reveal = useContext(LocalCommentReveal);
  useEffect(() => {
    const container = root.current, request = reveal.request;
    if (!container || !request || request.sourceAnchor.view !== view ||
        (path !== undefined && !sameProjectPath(request.sourceAnchor.path, path))) return;
    let cancelled = false, finished = false, frame = 0;
    const locate = () => {
      if (cancelled || finished) return;
      const target = resolveLocalCommentTarget(container, { path, previousPath, view, identity, base }, request.sourceAnchor);
      // Tree descendants may still be loading. Wait for their DOM rather than guessing a target.
      if (!target && view === "path" && container.querySelector('[role="status"]')) return;
      finished = true;
      if (!target) {
        reveal.complete?.({ requestId: request.requestId, status: "unavailable", reason: "来源当前不可定位：内容或精确位置已变化" });
        return;
      }
      scrollLocalCommentTarget(target);
      frame = requestAnimationFrame(() => {
        if (cancelled || !target.trigger.isConnected) return;
        const rect = localTargetRect(target);
        reveal.complete?.(rect.width > 0 && rect.height > 0
          ? { requestId: request.requestId, status: "located", screenAnchor: { x: rect.left, y: rect.top }, trigger: target.trigger }
          : { requestId: request.requestId, status: "unavailable", reason: "来源当前不可定位：目标不可见" });
      });
    };
    // Let ancestor expansion/filter effects commit before resolving tree coordinates.
    frame = requestAnimationFrame(locate);
    const observer = new MutationObserver(() => {
      if (finished) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(locate);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => { cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [root, path, previousPath, view, identity, base, reveal]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    if (!registry.entries.some((entry) => entry.sourceAnchor?.kind === "local")) {
      setPlacements([]);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next: Placement[] = [];
      const lanes = new Map<string, number>();
      for (const entry of registry.entries) {
        const anchor = entry.sourceAnchor;
        if (anchor?.kind !== "local") continue;
        const resolved = resolveLocalCommentTarget(container, { path, previousPath, view, identity, base }, anchor);
        if (!resolved?.trigger.isConnected) continue;
        const target = resolved.trigger;
        const rect = localTargetRect(resolved);
        if (rect.width <= 0 || rect.height <= 0) continue;
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
        let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
        for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
          const clip = ancestor.getBoundingClientRect();
          left = Math.max(left, clip.left); top = Math.max(top, clip.top);
          right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
        if (right - left < 20 || bottom - top < 12) continue;
        const key = `${Math.round(right)}:${Math.round(top)}`;
        const lane = lanes.get(key) ?? 0;
        lanes.set(key, lane + 1);
        const badgeLeft = right - 24 - lane * 28;
        if (badgeLeft < left) continue;
        next.push({ entry, left: badgeLeft, top, trigger: target });
      }
      setPlacements(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(container);
    const mutation = new MutationObserver(schedule);
    mutation.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      resize.disconnect(); mutation.disconnect();
    };
  }, [root, path, previousPath, view, identity, base, registry.entries]);
  return createPortal(<>{placements.map(({ entry, left, top, trigger }) =>
    <button key={entry.id} type="button" className="local-comment-marker" style={{ left, top }}
      aria-label={`编辑评论${entry.number}`} title={`评论${entry.number}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); registry.edit(entry.id, { x: left, y: top }, trigger); }}>{entry.number}</button>
  )}</>, document.body);
}
