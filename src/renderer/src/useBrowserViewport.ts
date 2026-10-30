import { useLayoutEffect, useRef, type RefObject } from "react";
import type { BrowserPanelLayout } from "../../shared/browser";

const blockers = '.file-reference-preview, [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [role="menu"]';

/** 只向主进程提交 CSS 坐标；缩放与窗口裁剪由原生边界完成。 */
export function useBrowserViewport(options: {
  active: boolean;
  suspended: boolean;
  zoomFactor: number;
  content: RefObject<HTMLDivElement | null>;
  onError: (message: string) => void;
}): void {
  const { active, suspended, zoomFactor, content } = options;
  const onError = useRef(options.onError);
  onError.current = options.onError;

  useLayoutEffect(() => {
    let live = true;
    let frame: number | undefined;
    let forceNext = false;
    let dragging = false;
    let previous = "";
    const node = content.current;
    const submit = (layout: BrowserPanelLayout, force = false) => {
      const key = JSON.stringify(layout);
      if (!force && previous === key) return;
      previous = key;
      void window.desktop.setBrowserLayout(layout).catch((error: unknown) => {
        if (live) onError.current(error instanceof Error ? error.message : String(error));
      });
    };
    const hide = () => submit({ visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } });
    if (!active || !node) {
      hide();
      return () => { live = false; };
    }
    const measure = (force = false) => {
      const rect = node.getBoundingClientRect();
      const covered = [...document.querySelectorAll<HTMLElement>(blockers)].some((element) => {
        if (element.hidden || element.closest("[hidden]")) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
      });
      submit({
        visible: !suspended && !dragging && !covered && rect.width > 0 && rect.height > 0,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }, force);
    };
    const schedule = (force = false) => {
      forceNext ||= force;
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const forced = forceNext;
        forceNext = false;
        measure(forced);
      });
    };
    const resize = () => { hide(); schedule(true); };
    const scroll = () => schedule();
    const startDrag = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".pane-resize-handle, .sidebar-resize-handle")) return;
      dragging = true;
      hide();
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      schedule(true);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => schedule());
    const observed = [node, node.closest(".workspace-columns"), document.querySelector(".sidebar"), document.querySelector(".workspace")];
    for (const element of observed) if (element) observer?.observe(element);
    // 仅观察相关遮挡节点；聊天流更新不触发无意义的布局 IPC。
    const mutation = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const target = record.target;
        if (target instanceof Element && (target.matches(blockers) || target.closest(blockers) || target.querySelector(blockers))) return true;
        return [...record.addedNodes, ...record.removedNodes].some((entry) => entry instanceof Element && (entry.matches(blockers) || Boolean(entry.querySelector(blockers))));
      });
      if (relevant) schedule();
    });
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "role", "aria-modal"] });
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", startDrag, true);
    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);
    document.addEventListener("lostpointercapture", endDrag, true);
    window.addEventListener("blur", endDrag);
    measure(true);
    return () => {
      live = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", startDrag, true);
      document.removeEventListener("pointerup", endDrag, true);
      document.removeEventListener("pointercancel", endDrag, true);
      document.removeEventListener("lostpointercapture", endDrag, true);
      window.removeEventListener("blur", endDrag);
      hide();
    };
  }, [active, suspended, zoomFactor, content]);
}
