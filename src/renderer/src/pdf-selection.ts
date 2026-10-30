export type PdfRect = [number, number, number, number];
export interface PdfTextItem { str: string; bbox: PdfRect; fontSize: number; fontName: string; dir: string; hasEOL: boolean; index: number; vertical?: boolean }
export interface PdfGraphic { bbox: PdfRect; raster?: boolean }
export interface PdfPageSelectionInput { viewBox: PdfRect; textItems: PdfTextItem[]; graphics: PdfGraphic[] }
export interface PdfSelectionBlock { id: string; kind: "paragraph" | "figure"; pageRect: PdfRect; text: string }
export const rectArea = (r: PdfRect): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
export function clipPdfRect(rect: PdfRect, view: PdfRect): PdfRect | null {
  if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) return null;
  const r: PdfRect = [Math.max(rect[0], view[0]), Math.max(rect[1], view[1]), Math.min(rect[2], view[2]), Math.min(rect[3], view[3])];
  return rectArea(r) > 0 ? r : null;
}
const union = (a: PdfRect, b: PdfRect): PdfRect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const overlap = (a: PdfRect, b: PdfRect): number => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
const intersects = (a: PdfRect, b: PdfRect): boolean => overlap(a, b) > 0 && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
const near = (a: PdfRect, b: PdfRect, d: number): boolean => a[0] <= b[2] + d && b[0] <= a[2] + d && a[1] <= b[3] + d && b[1] <= a[3] + d;
interface Line { rect: PdfRect; items: PdfTextItem[]; size: number; text: string }
const caption = (s: string): boolean => /^(?:fig(?:ure)?\.?\s*\d|图\s*\d)/i.test(s.trim());
const bullet = (s: string): boolean => /^\s*(?:[•●▪◦*-]|\d+[.)])\s/.test(s);
/** 在顶部向下的工作坐标内分栏；公开输入与输出始终保留未旋转 PDF 坐标。 */
export function buildPdfSelectionBlocks(input: PdfPageSelectionInput): PdfSelectionBlock[] {
  const view = input.viewBox;
  if (!view.every(Number.isFinite) || rectArea(view) === 0) return [];
  const flip = (r: PdfRect): PdfRect => [r[0], view[3] - r[3], r[2], view[3] - r[1]];
  const items = input.textItems.flatMap(item => {
    const r = clipPdfRect(item.bbox, view);
    return r && item.str.trim() && Number.isFinite(item.fontSize) && item.fontSize > 0 ? [{ ...item, bbox: flip(r) }] : [];
  }).sort((a, b) => a.bbox[3] - b.bbox[3] || a.bbox[0] - b.bbox[0]);
  // 窄栏沟可能小于1.5字号，且两栏基线常常错开；不能仅凭单行间距连接。
  // 先从至少三行的长文本左右边界识别持续空白走廊，不把普通词间距当栏沟。
  const substantial = items.filter(item => !item.vertical && item.dir !== "ttb" && item.bbox[2] - item.bbox[0] >= 12 * item.fontSize);
  const maxSize = substantial.reduce((size, item) => Math.max(size, item.fontSize), 0);
  const gutters: Array<{ left: number; right: number; top: number; bottom: number; rows: number[]; size: number }> = [];
  for (let i = 0; i < substantial.length; i++) {
    const a = substantial[i]!;
    for (let j = i + 1; j < substantial.length; j++) {
      const b = substantial[j]!;
      if (b.bbox[3] - a.bbox[3] > 1.6 * maxSize) break;
      const size = Math.max(a.fontSize, b.fontSize);
      if (Math.abs(a.bbox[3] - b.bbox[3]) > 1.6 * size) continue;
      const left = a.bbox[0] < b.bbox[0] ? a : b, right = left === a ? b : a;
      const gap = right.bbox[0] - left.bbox[2];
      if (gap < .5 * size || gap > 1.5 * size) continue;
      const row = (a.bbox[3] + b.bbox[3]) / 2;
      const previous = gutters.find(g => Math.min(g.right, right.bbox[0]) - Math.max(g.left, left.bbox[2]) >= Math.min(2, size * .25));
      if (previous) {
        previous.left = Math.max(previous.left, left.bbox[2]); previous.right = Math.min(previous.right, right.bbox[0]);
        previous.top = Math.min(previous.top, a.bbox[1], b.bbox[1]); previous.bottom = Math.max(previous.bottom, a.bbox[3], b.bbox[3]);
        if (previous.rows.every(y => Math.abs(y - row) > .75 * size)) previous.rows.push(row);
      } else gutters.push({ left: left.bbox[2], right: right.bbox[0], top: Math.min(a.bbox[1], b.bbox[1]), bottom: Math.max(a.bbox[3], b.bbox[3]), rows: [row], size });
    }
  }
  const persistentGutters = gutters.filter(g => g.rows.length >= 3 && g.bottom - g.top >= 2 * g.size);
  const lines: Line[] = [];
  for (const item of items) {
    let line: Line | undefined;
    if (!item.vertical && item.dir !== "ttb") {
      // 只检查当前基线附近的行；双栏的大空隙绝不作为同一行段。
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = lines[i]!;
        if (item.bbox[3] - candidate.rect[3] > Math.max(item.fontSize, candidate.size) * .35) break;
        if (persistentGutters.some(g => candidate.rect[2] <= g.left + .01 && item.bbox[0] >= g.right - .01 && item.bbox[1] <= g.bottom && item.bbox[3] >= g.top)) continue;
        if (Math.abs(item.bbox[3] - candidate.rect[3]) <= Math.max(item.fontSize, candidate.size) * .35 && item.bbox[0] - candidate.rect[2] <= 1.5 * Math.max(item.fontSize, candidate.size) && item.bbox[0] >= candidate.rect[0]) { line = candidate; break; }
      }
    }
    if (!line) lines.push({ rect: item.bbox, items: [item], size: item.fontSize, text: item.str });
    else {
      const gap = item.bbox[0] - line.rect[2];
      line.text += gap > item.fontSize * .15 && !/\s$/.test(line.text) && !/^\s/.test(item.str) ? ` ${item.str}` : item.str;
      line.rect = union(line.rect, item.bbox); line.items.push(item); line.size = Math.max(line.size, item.fontSize);
    }
  }
  const groupParagraphs = (source: Line[], figures: PdfRect[]): Line[][] => {
    const groups: Line[][] = [];
    for (const line of source) {
      let best: Line[] | undefined;
      let distance = Infinity;
      for (const group of groups) {
        const last = group[group.length - 1]!;
        if (line.items.some(t => t.vertical || t.dir === "ttb") || last.items.some(t => t.vertical || t.dir === "ttb")) continue;
        if (line.rect[2] - line.rect[0] < 12 * line.size || last.rect[2] - last.rect[0] < 12 * last.size) continue;
        const dy = line.rect[1] - last.rect[1];
        const ratio = line.size / last.size;
        const sameColumn = overlap(line.rect, last.rect) >= Math.min(line.rect[2] - line.rect[0], last.rect[2] - last.rect[0]) * .5 || Math.abs(line.rect[0] - last.rect[0]) <= line.size * 1.5;
        const indent = Math.abs(line.rect[0] - last.rect[0]);
        // 首行缩进后的回退仍属同段；后续行再次缩进才开始下一段。
        const firstLineOutdent = group.length === 1 && line.rect[0] < last.rect[0] && indent <= 3 * line.size;
        const between: PdfRect = [Math.min(line.rect[0], last.rect[0]), last.rect[3], Math.max(line.rect[2], last.rect[2]), line.rect[1]];
        if (sameColumn && dy > 0 && dy <= 1.6 * Math.max(last.size, last.rect[3] - last.rect[1]) && ratio >= .85 && ratio <= 1.18 && (indent <= .8 * line.size || firstLineOutdent) && !bullet(line.text) && !caption(line.text) && !caption(last.text) && !figures.some(f => intersects(f, between)) && dy < distance) { best = group; distance = dy; }
      }
      if (best) best.push(line); else groups.push([line]);
    }
    return groups;
  };
  const preliminary = groupParagraphs(lines, []);
  const barriers = preliminary.filter(g => g.length >= 3 && !caption(g[0]!.text) && g.reduce((s, l) => s + (l.rect[2] - l.rect[0]) / l.size, 0) / g.length >= 12).map(g => g.map(l => l.rect).reduce(union));
  const cellSize = Math.max(64, (view[2] - view[0]) / 128, (view[3] - view[1]) / 128);
  const candidates = input.graphics.flatMap(g => {
    const r = clipPdfRect(g.bbox, view); if (!r) return [];
    const w = r[2] - r[0], h = r[3] - r[1];
    if (!g.raster && rectArea(r) > rectArea(view) * .85) return [];
    return [{ rect: flip(r), thin: !g.raster && Math.max(w, h) / Math.min(w, h) > 40 && Math.min(w, h) < 2 }];
  });
  const endpointBuckets = new Map<string, PdfRect[]>();
  for (const { rect, thin } of candidates) if (!thin) {
    for (let x = Math.floor((rect[0] - 8) / cellSize); x <= Math.floor((rect[2] + 8) / cellSize); x++) for (let y = Math.floor((rect[1] - 8) / cellSize); y <= Math.floor((rect[3] + 8) / cellSize); y++) {
      const key = `${x},${y}`, bucket = endpointBuckets.get(key) ?? [];
      bucket.push(rect); endpointBuckets.set(key, bucket);
    }
  }
  const graphics = candidates.filter(({ rect, thin }) => {
    if (!thin) return true;
    // 细长线只有两端分别连接不同图形时才是连接线，孤立页分隔线仍排除。
    const horizontal = rect[2] - rect[0] >= rect[3] - rect[1];
    const ends = horizontal ? [[rect[0], (rect[1] + rect[3]) / 2], [rect[2], (rect[1] + rect[3]) / 2]] : [[(rect[0] + rect[2]) / 2, rect[1]], [(rect[0] + rect[2]) / 2, rect[3]]];
    const neighbors = ends.map(([x, y]) => (endpointBuckets.get(`${Math.floor(x! / cellSize)},${Math.floor(y! / cellSize)}`) ?? []).filter(r => x! >= r[0] - 8 && x! <= r[2] + 8 && y! >= r[1] - 8 && y! <= r[3] + 8));
    return neighbors[0]!.some(a => neighbors[1]!.some(b => a !== b));
  }).map(candidate => candidate.rect);
  // 空间桶找近邻，避免把成千上万条绘图指令逐对比较。
  const parents = graphics.map((_, i) => i), buckets = new Map<string, number[]>();
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]!]!; i = parents[i]!; } return i; };
  graphics.forEach((r, i) => {
    const seen = new Set<number>();
    for (let x = Math.floor((r[0] - 8) / cellSize); x <= Math.floor((r[2] + 8) / cellSize); x++) for (let y = Math.floor((r[1] - 8) / cellSize); y <= Math.floor((r[3] + 8) / cellSize); y++) {
      const key = `${x},${y}`, bucket = buckets.get(key) ?? [];
      for (const j of bucket) if (!seen.has(j)) {
        seen.add(j); const other = graphics[j]!;
        if (near(r, other, 8) && !barriers.some(b => intersects(b, union(r, other)))) parents[root(i)] = root(j);
      }
      bucket.push(i); buckets.set(key, bucket);
    }
  });
  const components = new Map<number, PdfRect>();
  graphics.forEach((r, i) => { const key = root(i), old = components.get(key); components.set(key, old ? union(old, r) : r); });
  const figures = [...components.values()].filter(r => r[2] - r[0] >= 12 && r[3] - r[1] >= 12 && rectArea(r) >= 144);
  const included = new Set<Line>();
  for (let i = 0; i < figures.length; i++) {
    let figure = figures[i]!;
    for (const line of lines) {
      const short = line.items.length <= 12 && line.text.length <= 120 && !barriers.some(b => intersects(b, line.rect));
      const label = short && near(figure, line.rect, 6) && line.rect[0] >= figure[0] - 6 && line.rect[2] <= figure[2] + 6;
      const cap = caption(line.text) && line.rect[1] >= figure[3] - 2 && line.rect[1] - figure[3] <= 18 && overlap(figure, line.rect) >= Math.min(figure[2] - figure[0], line.rect[2] - line.rect[0]) * .5;
      if (label || cap) { figure = union(figure, line.rect); included.add(line); }
    }
    figures[i] = figure;
  }
  for (let i = figures.length - 1; i >= 0; i--) {
    const a = figures[i]!;
    if (figures.some((b, j) => j !== i && (rectArea(b) > rectArea(a) || (rectArea(b) === rectArea(a) && j < i)) && overlap(a, b) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) >= .9 * rectArea(a))) figures.splice(i, 1);
  }
  const result: PdfSelectionBlock[] = [];
  figures.forEach((r, i) => {
    const pdf = flip([r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2]);
    const clipped = clipPdfRect(pdf, view); if (clipped) result.push({ id: `figure-${i}`, kind: "figure", pageRect: clipped, text: lines.filter(l => included.has(l) && near(r, l.rect, 0)).map(l => l.text).join("\n") });
  });
  groupParagraphs(lines.filter(l => !included.has(l)), figures).forEach((g, i) => result.push({ id: `paragraph-${i}`, kind: "paragraph", pageRect: flip(g.map(l => l.rect).reduce(union)), text: g.map(l => l.text).join("\n") }));
  return result;
}
export function choosePdfBlock(blocks: PdfSelectionBlock[], x: number, y: number): PdfSelectionBlock | undefined {
  return blocks.filter(b => x >= b.pageRect[0] && x <= b.pageRect[2] && y >= b.pageRect[1] && y <= b.pageRect[3]).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "figure" ? -1 : 1) || rectArea(a.pageRect) - rectArea(b.pageRect))[0];
}

export interface PdfPointViewport { convertToViewportPoint(x: number, y: number): number[]; convertToPdfPoint(x: number, y: number): number[] }
/** PDF.js 6 已移除 rectangle 方法；四角投影支持非零 CropBox 与全部直角旋转。 */
export function pdfRectToViewport(rect: PdfRect, viewport: PdfPointViewport): PdfRect {
  const points = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]].map(p => viewport.convertToViewportPoint(p[0]!, p[1]!));
  return [Math.min(...points.map(p => p[0]!)), Math.min(...points.map(p => p[1]!)), Math.max(...points.map(p => p[0]!)), Math.max(...points.map(p => p[1]!))];
}
