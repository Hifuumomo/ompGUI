import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import remarkMath from "remark-math";

export const PLAN_DOCUMENT_LIMIT = 1024 * 1024;
export interface PlanHeading { id: string; level: number; text: string; position: number }
interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  value?: string;
  meta?: string | null;
}
export interface PlanSourceBlock { sourceId: number; source: string; before: string }
const supported: Record<string, true> = {
  root: true, paragraph: true, heading: true, text: true, emphasis: true, strong: true,
  delete: true, inlineCode: true, code: true, blockquote: true, list: true, listItem: true,
  thematicBreak: true, break: true, link: true, image: true, table: true, tableRow: true, tableCell: true,
};

export function assertPlanSize(source: string): void {
  if (new TextEncoder().encode(source).byteLength > PLAN_DOCUMENT_LIMIT)
    throw new Error("计划正文超过 1 MiB，无法编辑或保存");
}
function unsupported(node: MarkdownNode): boolean {
  return !supported[node.type] || (node.type === "code" && !!node.meta) || !!node.children?.some(unsupported);
}
/** 解析器只接收 LF 与无 BOM 的文本；AST offset 映射回原文后再截取字节。 */
function parsePlanTree(source: string, parse: (source: string) => MarkdownNode): MarkdownNode {
  const offsets = [source.startsWith("\uFEFF") ? 1 : 0];
  let normalized = "";
  for (let offset = offsets[0]; offset < source.length;) {
    const character = source[offset++];
    if (character === "\r") {
      if (source[offset] === "\n") offset++;
      normalized += "\n";
    } else normalized += character;
    offsets.push(offset);
  }
  const tree = parse(normalized);
  const restore = (node: MarkdownNode): void => {
    if (node.position) {
      for (const point of [node.position.start, node.position.end]) {
        if (point.offset !== undefined) point.offset = offsets[point.offset];
      }
    }
    node.children?.forEach(restore);
  };
  restore(tree);
  return tree;
}
/** 在最小完整顶层块上保留无 schema 的语法，绝不把 HTML 交给 DOM。 */
export function protectPlanTree(tree: MarkdownNode, source: string): PlanSourceBlock[] {
  const blocks: PlanSourceBlock[] = [];
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(source);
  let previousEnd = 0;
  const children = tree.children ?? [];
  const result: MarkdownNode[] = [];
  let frontAdded = false;
  for (const node of children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error("无法定位计划 Markdown 原文，已停止保存");
    if (frontmatter && start < frontmatter[0].length) {
      if (!frontAdded) {
        const value = frontmatter[0].replace(/\r?\n$/, "");
        result.push({ type: "planRaw", value });
        blocks.push({ sourceId: blocks.length, source: value, before: "" });
        previousEnd = value.length;
        frontAdded = true;
      }
      // 前言闭合符后的普通正文仍保留；跨越边界则保守保护整个块。
      if (end <= frontmatter[0].length) continue;
    }
    const raw = source.slice(start, end);
    result.push(unsupported(node) || /^\s*:::/m.test(raw) || (frontmatter && start < frontmatter[0].length)
      ? { type: "planRaw", value: raw } : node);
    blocks.push({ sourceId: blocks.length, source: raw, before: source.slice(previousEnd, start) });
    previousEnd = end;
  }
  tree.children = result;
  return blocks;
}

export const planRawBlock = $nodeSchema("plan_raw_block", () => ({
  group: "block", content: "text*", marks: "", code: true, defining: true, isolating: true,
  parseDOM: [{ tag: "pre[data-plan-raw]", preserveWhitespace: "full" }],
  toDOM: () => ["pre", { "data-plan-raw": "true", "aria-label": "原始 Markdown", class: "plan-raw-block" }, ["code", 0]],
  parseMarkdown: {
    match: (node) => node.type === "planRaw",
    runner: (state, node, type) => { state.openNode(type); if (node.value) state.addText(node.value as string); state.closeNode(); },
  },
  toMarkdown: {
    match: (node) => node.type.name === "plan_raw_block",
    runner: (state, node) => { state.addNode("html", undefined, undefined, { value: node.textContent }); },
  },
}));

/** sourceId 只存在内存中；未改变的块复用原始字节，绝不泄露到 Markdown。 */
export class PlanMarkdownSource {
  private source: string;
  private blocks: PlanSourceBlock[] = [];
  private original?: ProseNode;
  private nodes: { sourceId: number; node: ProseNode }[] = [];
  private trailing = "";
  private parsingSource = "";
  readonly remark = $remark("plan-source-preservation", () => {
    const owner = this;
    return function (this: unknown) {
      const processor = this as { parser: (source: string, ...args: unknown[]) => MarkdownNode };
      const parse = processor.parser;
      processor.parser = function (source: string, ...args: unknown[]) {
        const tree = parsePlanTree(source, (normalized) => parse.call(processor, normalized, ...args));
        const blocks = protectPlanTree(tree, source);
        if (source === owner.parsingSource) owner.blocks = blocks;
        return tree;
      };
    };
  });
  readonly math = $remark("plan-math-preservation", () => remarkMath);
  constructor(source: string) { assertPlanSize(source); this.source = source; this.parsingSource = source; }
  prepare(source: string): void { assertPlanSize(source); this.source = source; this.parsingSource = source; this.original = undefined; this.nodes = []; }
  capture(doc: ProseNode): void {
    if (this.blocks.length !== doc.childCount && !(this.blocks.length === 0 && doc.textContent === ""))
      throw new Error("计划 Markdown 解析不完整，已停止保存并保留原文");
    this.original = doc;
    this.nodes = [];
    doc.forEach((node, _offset, index) => { if (this.blocks[index]) this.nodes.push({ sourceId: index, node }); });
    const used = this.blocks.reduce((sum, block) => sum + block.before.length + block.source.length, 0);
    this.trailing = this.source.slice(used);
  }
  serialize(doc: ProseNode, serialize: (doc: ProseNode) => string): string {
    if (!this.original) throw new Error("计划编辑器尚未准备好");
    if (doc.eq(this.original)) return this.source;
    const newline = this.source.includes("\r\n") ? "\r\n" : "\n";
    const used = new Set<number>();
    const current: ProseNode[] = [];
    doc.forEach((node) => { current.push(node); });
    const ids = current.map((node) => {
      const found = this.nodes.find((entry) => !used.has(entry.sourceId) && entry.node.eq(node));
      if (found) used.add(found.sourceId);
      return found?.sourceId;
    });
    // 两个未改动的锚点之间仍是一对一的块时，只复用分隔符，不复用已改正文。
    const boundaries = [-1, ...ids.flatMap((id, index) => id === undefined ? [] : [index]), current.length];
    const separators = [...ids];
    for (let boundary = 1; boundary < boundaries.length; boundary++) {
      const left = boundaries[boundary - 1];
      const right = boundaries[boundary];
      const firstId = left < 0 ? 0 : ids[left]! + 1;
      const endId = right === current.length ? this.blocks.length : ids[right]!;
      if (right - left - 1 !== endId - firstId) continue;
      for (let index = left + 1; index < right; index++) separators[index] = firstId + index - left - 1;
    }
    let previousId: number | undefined;
    let output = "";
    current.forEach((node, index) => {
      const id = separators[index];
      const block = ids[index] === undefined ? undefined : this.blocks[ids[index]!];
      const separator = index === 0
        ? (id === 0 ? this.blocks[0]?.before ?? "" : this.source.startsWith("\uFEFF") ? "\uFEFF" : "")
        : id !== undefined && id > 0 ? this.blocks[id].before : newline + newline;
      const text = block?.source ?? (node.type.name === "plan_raw_block" ? node.textContent
        : serialize(doc.type.create(null, node)).replace(/(?:\r\n|\r|\n)+$/, "").replace(/\r\n|\r|\n/g, newline));
      output += separator + text;
      previousId = id;
    });
    if (previousId === this.blocks.length - 1) output += this.trailing;
    else if (/\r?\n$/.test(this.source)) output += newline;
    assertPlanSize(output);
    return output;
  }
}

export function planHeadings(doc: ProseNode): PlanHeading[] {
  const headings: PlanHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading") headings.push({ id: `plan-heading-${position}`, level: Number(node.attrs.level), text: node.textContent, position });
  });
  return headings;
}
