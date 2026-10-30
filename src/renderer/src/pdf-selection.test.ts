import { describe, expect, it } from "vitest";
import { buildPdfSelectionBlocks, choosePdfBlock, clipPdfRect, pdfRectToViewport } from "./pdf-selection";
import type { PdfRect, PdfTextItem, PdfPointViewport } from "./pdf-selection";
import { createPdfSelectionTestFixture } from "./pdf-selection-test-fixture";

function text(str: string, x: number, y: number, width = 200, size = 10, index = 0): PdfTextItem {
  return { str, bbox: [x, y, x + width, y + size], fontSize: size, fontName: "Helvetica", dir: "ltr", hasEOL: true, index };
}
const viewBox: PdfRect = [0, 0, 600, 800];

describe("PDF selection geometry", () => {
  it("keeps columns independent, headings separate and indentation as a new paragraph", () => {
    const blocks = buildPdfSelectionBlocks({ viewBox, graphics: [], textItems: [
      text("Document heading", 40, 750, 310, 20),
      text("Left first", 40, 710), text("Left second", 40, 696), text("Left third", 40, 682),
      text("Right first", 330, 710), text("Right second", 330, 696), text("Right third", 330, 682),
      text("Indented paragraph", 52, 660), text("Indented second", 52, 646),
    ] });
    expect(choosePdfBlock(blocks, 80, 704)?.text).toBe("Left first\nLeft second\nLeft third");
    expect(choosePdfBlock(blocks, 350, 704)?.text).toBe("Right first\nRight second\nRight third");
    expect(choosePdfBlock(blocks, 80, 654)?.text).toBe("Indented paragraph\nIndented second");
    expect(choosePdfBlock(blocks, 100, 759)?.text).toBe("Document heading");
    expect(choosePdfBlock(blocks, 290, 700)).toBeUndefined();
  });
  it("keeps an indented first line with its outdented continuation without merging the next paragraph", () => {
    const blocks = buildPdfSelectionBlocks({ viewBox, graphics: [], textItems: [
      text("Indented lead line", 52, 710, 188),
      text("First paragraph continues", 40, 696), text("First paragraph ends", 40, 682),
      text("Next indented lead", 52, 668, 188), text("Next paragraph continues", 40, 654),
    ] });
    expect(choosePdfBlock(blocks, 80, 700)?.text).toBe("Indented lead line\nFirst paragraph continues\nFirst paragraph ends");
    expect(choosePdfBlock(blocks, 80, 660)?.text).toBe("Next indented lead\nNext paragraph continues");
  });
  it("protects a repeated narrow gutter between staggered columns of different font sizes without splitting justified word spaces", () => {
    const textItems = [
      text("Left paragraph first line", 45.58, 575.94, 245.2, 8.76),
      text("Left justified", 45.58, 565.62, 100, 8.76),
      text("line continuation", 154.98, 565.62, 135.8, 8.76),
      text("Left paragraph third line", 45.58, 555.30, 245.2, 8.76),
      text("Left paragraph fourth line", 45.58, 544.98, 245.2, 8.76),
      text("Right paragraph first line", 304.8, 573.54, 245.4, 9.694),
      text("Right paragraph second line", 304.8, 561.54, 245.4, 9.694),
      text("Right paragraph third line", 304.8, 549.54, 245.4, 9.694),
      text("Right paragraph fourth line", 304.8, 537.54, 245.4, 9.694),
    ];
    const blocks = buildPdfSelectionBlocks({ viewBox: [0, 0, 595, 842], textItems, graphics: [] });
    const left = choosePdfBlock(blocks, 100, 579)!, right = choosePdfBlock(blocks, 350, 577)!;
    expect(left.text).toBe("Left paragraph first line\nLeft justified line continuation\nLeft paragraph third line\nLeft paragraph fourth line");
    expect(right.text).toContain("Right paragraph");
    expect(left.text).not.toContain("Right");
    expect(right.text).not.toContain("Left");
    expect(left.pageRect[2]).toBeLessThan(304.8);
  });
  it("groups vector nodes, arrows, labels and caption without absorbing body paragraphs", () => {
    const blocks = buildPdfSelectionBlocks({ viewBox, textItems: [
      text("Body paragraph line one", 40, 740, 220), text("Body paragraph line two", 40, 726, 220), text("Body paragraph line three", 40, 712, 220),
      text("Input", 100, 510, 30), text("Output", 100, 440, 40), text("Figure 1. Flow diagram", 75, 405, 130),
    ], graphics: [{ bbox: [80, 490, 180, 540] }, { bbox: [129, 470, 131, 490] }, { bbox: [80, 420, 180, 470] }] });
    const figure = choosePdfBlock(blocks, 110, 515)!;
    expect(figure.kind).toBe("figure");
    expect(figure.text).toContain("Input"); expect(figure.text).toContain("Output"); expect(figure.text).toContain("Figure 1");
    expect(figure.pageRect).toEqual([73, 403, 207, 542]);
    expect(choosePdfBlock(blocks, 90, 730)?.kind).toBe("paragraph");
    expect(figure.text).not.toContain("Body");
  });
  it("preserves an eighty-point thin flow connector but excludes an unrelated separator", () => {
    const blocks = buildPdfSelectionBlocks({ viewBox, textItems: [], graphics: [
      { bbox: [50, 400, 90, 440] }, { bbox: [170, 400, 210, 440] },
      { bbox: [90, 419.5, 170, 420.5] }, { bbox: [20, 100, 580, 101] },
    ] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("figure");
    expect(blocks[0]?.pageRect).toEqual([48, 398, 212, 442]);
  });
  it("retains a full-page raster scan, rejects vector backgrounds and thin decorations", () => {
    const scan = buildPdfSelectionBlocks({ viewBox, textItems: [], graphics: [{ bbox: viewBox, raster: true }] });
    expect(scan).toHaveLength(1); expect(scan[0]?.pageRect).toEqual(viewBox);
    const vectors = buildPdfSelectionBlocks({ viewBox, textItems: [], graphics: [{ bbox: viewBox }, { bbox: [20, 100, 580, 101] }] });
    expect(vectors).toEqual([]);
    expect(buildPdfSelectionBlocks({ viewBox, textItems: [text("Text-only page", 40, 700)], graphics: [] })[0]?.kind).toBe("paragraph");
  });
  it("clips to a nonzero CropBox and rejects malformed rectangles rather than normalizing them", () => {
    const crop: PdfRect = [-20, 30, 480, 730];
    expect(clipPdfRect([-50, 10, 100, 100], crop)).toEqual([-20, 30, 100, 100]);
    for (const rect of [[1, 1, 1, 4], [4, 4, 2, 2], [NaN, 0, 3, 3], [0, 0, Infinity, 2]] as PdfRect[]) expect(clipPdfRect(rect, crop)).toBeNull();
    const blocks = buildPdfSelectionBlocks({ viewBox: crop, textItems: [], graphics: [{ bbox: [-50, 10, 100, 100], raster: true }] });
    expect(blocks[0]?.pageRect).toEqual([-20, 30, 102, 102]);
    expect(buildPdfSelectionBlocks({ viewBox: [100, 100, 0, 0], textItems: [], graphics: [] })).toEqual([]);
  });
  it("does not merge vertical or nonorthogonal text into a claimed paragraph", () => {
    const a = { ...text("rotated one", 50, 700, 30), vertical: true }, b = { ...text("rotated two", 50, 686, 30), dir: "ttb" };
    const blocks = buildPdfSelectionBlocks({ viewBox, textItems: [a, b], graphics: [] });
    expect(blocks).toHaveLength(2); expect(blocks.map(block => block.text)).toEqual(["rotated one", "rotated two"]);
  });
  it("prioritizes a figure label over overlapping text and uses the smallest same-kind block", () => {
    const blocks = [
      { id: "text", kind: "paragraph" as const, pageRect: [10, 10, 20, 20] as PdfRect, text: "label" },
      { id: "figure", kind: "figure" as const, pageRect: [0, 0, 100, 100] as PdfRect, text: "" },
      { id: "small", kind: "figure" as const, pageRect: [5, 5, 25, 25] as PdfRect, text: "" },
    ];
    expect(choosePdfBlock(blocks, 15, 15)?.id).toBe("small");
  });
  for (const rotation of [0, 90, 180, 270]) it(`round-trips CropBox rectangles at ${rotation} degrees with a content origin independent of page borders`, () => {
    const angle = rotation * Math.PI / 180, c = Math.round(Math.cos(angle)), s = Math.round(Math.sin(angle));
    const viewport: PdfPointViewport = {
      convertToViewportPoint(x, y) { return [2 * ((x + 20) * c - (y - 30) * s), 2 * ((x + 20) * s + (y - 30) * c)]; },
      convertToPdfPoint(x, y) { return [x / 2 * c + y / 2 * s - 20, -x / 2 * s + y / 2 * c + 30]; },
    };
    const rect: PdfRect = [10, 60, 90, 120], projected = pdfRectToViewport(rect, viewport);
    const contentOrigin = { x: 109, y: 209 }; // 外层 page 的9px边框不参与内容变换。
    const screen = [projected[0] + contentOrigin.x, projected[1] + contentOrigin.y, projected[2] + contentOrigin.x, projected[3] + contentOrigin.y];
    const a = viewport.convertToPdfPoint(screen[0]! - contentOrigin.x, screen[1]! - contentOrigin.y), b = viewport.convertToPdfPoint(screen[2]! - contentOrigin.x, screen[3]! - contentOrigin.y);
    expect([Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!)]).toEqual(rect);
  });
  it("generates a byte-stable self-owned two-page PDF with raster and vector content", () => {
    const bytes = createPdfSelectionTestFixture(), pdf = new TextDecoder().decode(bytes);
    expect(pdf.startsWith("%PDF-1.7")).toBe(true); expect(pdf).toContain("/Count 2"); expect(pdf).toContain("/Subtype /Image"); expect(pdf).toContain("/Rotate 90");
    const offset = Number(pdf.match(/startxref\n(\d+)/)?.[1]); expect(pdf.slice(offset, offset + 4)).toBe("xref");
    expect(createPdfSelectionTestFixture()).toEqual(bytes);
  });
});
