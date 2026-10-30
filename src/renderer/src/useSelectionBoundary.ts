import { useEffect } from "react";

// 取最近的阅读区域；并排 diff 两侧独立，主对话仍允许跨消息选择。
const regions = ".conversation-review, .sidebar, .code-review-source, .project-files, .file-code-view, [data-diff-side], .btw-panel-reader, .jobs-output, .plan-document";
const controls = "input, textarea, select, button, [contenteditable]:not([contenteditable='false']), [draggable='true'], [role='separator']";

// 键盘全选比鼠标拖选更细：代码、输出和分支独立；导航列表不是阅读目标。
const selectAllRegions = [
  ".conversation-review", ".rich-code", ".inline-tool-source", ".inline-tool-output",
  ".transcript-evidence pre", ".tool-inspector pre", ".file-review-source",
  ".code-review-source", "[data-diff-side]", ".btw-panel-reader", ".plan-document",
  ".todo-list", ".rewind-branch-column", ".rewind-transcript", ".modal-body",
  ".jobs-output", ".job-output", ".subagent-inspector", ".subagent-inspector pre",
  ".subagent-recent", ".subagent-transcript",
].join(", ");
const navigation = "button, [role='button'], nav, [role='menu'], [role='listbox'], [role='tree'], [role='toolbar'], .sidebar, .project-files, .conversation-outline, [role='separator']";
const selectAllClass = "selection-boundary-all";

/** 输入控件和富文本编辑器自行处理全选；复选框等非文本控件不能放行页面全选。 */
function nativeEditing(target: Element): boolean {
  if (target.closest("textarea, select, [contenteditable]:not([contenteditable='false'])")) return true;
  const input = target.closest("input");
  return !!input && !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/.test(input.type);
}

/** 从实际交互位置取最近正文，避免回退的单条 Transcript 或 Diff 外壳扩大选择范围。 */
function readingRegion(target: Element): HTMLElement | null {
  if (nativeEditing(target) || target.closest(navigation)) return null;
  let root = target.closest<HTMLElement>(selectAllRegions);
  if (root?.matches(".conversation-review")) {
    root = root.closest<HTMLElement>(".rewind-branch-column, .rewind-transcript") ?? root;
  }
  if (root?.matches(".rewind-transcript") && root.querySelector(".rewind-branch-column")) {
    return root.querySelector(".rewind-target")?.closest<HTMLElement>(".rewind-branch-column") ?? null;
  }
  if (root?.matches(".code-review-source")) {
    const sides = root.querySelectorAll<HTMLElement>("[data-diff-side]");
    // 未明确进入哪一侧时不猜测，更不能把两侧内容拼在一起。
    if (sides.length) return sides.length === 1 ? sides[0] : null;
    return root.querySelector<HTMLElement>(".file-review-source") ?? root;
  }
  return root;
}

/** 已关闭、折叠、隐藏或卸载的阅读区不能继续作为键盘目标。 */
function available(root: Element): boolean {
  return root.isConnected && !root.closest("[hidden], [inert], [aria-hidden='true']") &&
    root.getClientRects().length > 0 && getComputedStyle(root).visibility === "visible";
}

/** 鼠标拖选保持原边界；Ctrl/Cmd+A 只全选当前阅读区域，不抢输入框或独立视图的焦点。 */
export function useSelectionBoundary(): void {
  useEffect(() => {
    let region: Element | null = null;
    let recent: HTMLElement | null = null;
    let selected: HTMLElement | null = null;
    const clearSelectionStyle = () => {
      selected?.classList.remove(selectAllClass);
      selected = null;
    };
    const constrain = () => {
      const selection = document.getSelection();
      if (selected && (!selected.isConnected || !selection?.anchorNode || !selection.focusNode ||
        selection.isCollapsed || !selected.contains(selection.anchorNode) || !selected.contains(selection.focusNode)))
        clearSelectionStyle();
      if (!region?.isConnected || !selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;
      if (region.contains(selection.anchorNode) && region.contains(selection.focusNode)) return;
      const bounds = document.createRange();
      bounds.selectNodeContents(region);
      // comparePoint 以文档顺序判断越界方向，保留反向拖选的 anchor/focus。
      const endpoint = (node: Node, offset: number): [Node, number] => {
        const side = bounds.comparePoint(node, offset);
        return side < 0 ? [bounds.startContainer, bounds.startOffset] : side > 0 ? [bounds.endContainer, bounds.endOffset] : [node, offset];
      };
      const anchor = endpoint(selection.anchorNode, selection.anchorOffset);
      const focus = endpoint(selection.focusNode, selection.focusOffset);
      selection.setBaseAndExtent(...anchor, ...focus);
    };
    const start = (event: PointerEvent) => {
      region = null;
      if (event.button !== 0 || !event.isPrimary) return;
      clearSelectionStyle();
      recent = event.target instanceof Element ? readingRegion(event.target) : null;
      if (event.target instanceof Element && !event.target.closest(controls))
        region = event.target.closest(regions);
    };
    const finish = () => { constrain(); region = null; };
    const cancel = () => { region = null; recent = null; };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      // 点击代码块可能让可聚焦的外层阅读器获得焦点，仍以刚点击的小区域为准。
      if (!recent || !event.target.contains(recent)) recent = readingRegion(event.target);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Tab") recent = null;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey ||
        event.key.toLowerCase() !== "a") return;
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (target && nativeEditing(target)) return;

      // 即使没有有效阅读区，也要阻止浏览器退化为整个 GUI 的全选。
      event.preventDefault();
      region = null;
      if (recent && !available(recent)) recent = null;
      const root = recent && target?.contains(recent) ? recent : target ? readingRegion(target) : null;
      clearSelectionStyle();
      if (!root || !available(root)) return;
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      for (let index = dialogs.length - 1; index >= 0; index--) {
        if (!available(dialogs[index])) continue;
        if (!dialogs[index].contains(root)) return;
        break;
      }
      const selection = document.getSelection();
      if (!selection) return;
      selected = root;
      root.classList.add(selectAllClass);
      selection.selectAllChildren(root);
    };
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("selectionchange", constrain);
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("selectionchange", constrain);
      document.removeEventListener("pointerup", finish, true);
      document.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
      clearSelectionStyle();
    };
  }, []);
}
