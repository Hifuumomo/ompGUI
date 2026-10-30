/** 将选区中的 KaTeX 排版替换为原始 TeX；普通选区保持浏览器原生文本。 */
export function richSelectionText(selection: Selection): string {
  if (!selection.rangeCount || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0).cloneRange();
  const formulaAt = (node: Node) => {
    const formula = (node instanceof Element ? node : node.parentElement)?.closest(".katex");
    return formula?.closest(".katex-display") ?? formula;
  };
  const start = formulaAt(range.startContainer);
  const end = formulaAt(range.endContainer);
  // 公式是一个语义单元；不能把半个分数或上下标当成完整表达式复制。
  if (start) range.setStartBefore(start);
  if (end) range.setEndAfter(end);
  const fragment = range.cloneContents();
  const formulas = fragment.querySelectorAll(".katex");
  if (!formulas.length) return selection.toString();
  for (const formula of formulas) {
    const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (source === undefined || source === null) continue;
    const display = formula.closest(".katex-display");
    formula.replaceWith(document.createTextNode(display ? `$$\n${source}\n$$` : `$${source}$`));
  }
  fragment.querySelectorAll(".rich-math-controls, .rich-source-toolbar, button, [hidden]").forEach(node => node.remove());
  let text = "";
  let pendingBreak = 0;
  const blocks = new Set(["P", "DIV", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL"]);
  // 只生成结构性换行；不压缩源码或普通文本内部已有的空格、空行。
  const visit = (node: Node, pre = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (!value || (!pre && pendingBreak && /^\s*$/.test(value))) return;
      if (text && pendingBreak) {
        const trailing = /\n*$/.exec(text)![0].length;
        text += "\n".repeat(Math.max(0, pendingBreak - trailing));
      }
      pendingBreak = 0;
      text += value;
      return;
    }
    const element = node instanceof Element ? node : undefined;
    if (element?.tagName === "BR") { pendingBreak = Math.max(pendingBreak, 1); return; }
    const separation = element && (blocks.has(element.tagName) || element.classList.contains("katex-display")) ? 2 : element?.tagName === "LI" || element?.tagName === "TR" ? 1 : 0;
    pendingBreak = Math.max(pendingBreak, separation);
    if (element?.tagName === "DETAILS" && !element.hasAttribute("open")) {
      const summary = element.querySelector(":scope > summary");
      if (summary) visit(summary, pre);
    } else {
      for (const child of node.childNodes) visit(child, pre || element?.tagName === "PRE");
    }
    if (element?.tagName === "TD" || element?.tagName === "TH") text += "\t";
    pendingBreak = Math.max(pendingBreak, separation);
  };
  visit(fragment);
  return text;
}

/** 原生复制事件仅接管包含公式的阅读选区，输入框和普通文本保留默认行为。 */
export function copyRichSelection(event: ClipboardEvent, root: HTMLElement): void {
  if (event.defaultPrevented || !event.clipboardData) return;
  const target = event.target;
  if (target instanceof Element && target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) return;
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const formulas = root.querySelectorAll(".katex");
  if (![...formulas].some(formula => range.intersectsNode(formula))) return;
  event.clipboardData.setData("text/plain", richSelectionText(selection));
  event.preventDefault();
}
