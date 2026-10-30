/** 自有最小 PDF fixture；不依赖第二个 PDF 引擎，也不进入产品入口。 */
export function createPdfSelectionTestFixture(): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const stream = (data: string, dictionary = "") => `<< /Length ${data.length} ${dictionary} >>\nstream\n${data}\nendstream`;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
  const resources = "/Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >>";
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${resources} /Contents 6 0 R /Annots [9 0 R] >>`);
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [-20 -20 612 792] /CropBox [20 30 592 762] /Rotate 90 ${resources} /Contents 7 0 R >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const text = (x: number, y: number, value: string, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${value.replace(/[()\\]/g, "\\$&")}) Tj ET\n`;
  let first = text(42, 748, "Two-column PDF selection fixture", 20);
  for (const x of [42, 324]) {
    first += text(x, 710, x === 42 ? "Left column paragraph begins here." : "Right column stays independent.");
    first += text(x, 695, "Every line belongs to this column only.");
    first += text(x, 680, "Selection must preserve these line breaks.");
    first += text(x + 12, 645, "Indented new paragraph starts here.");
    first += text(x + 12, 630, "A second line continues its own paragraph.");
  }
  first += "q 130 0 0 90 55 480 cm /Im1 Do Q\n" + text(55, 462, "Figure 1. Embedded RGB image");
  first += "0.1 0.2 0.5 RG 2 w 340 510 90 44 re S 340 420 90 44 re S 385 510 m 385 464 l S 380 470 m 385 464 l 390 470 l S\n";
  first += text(355, 528, "Input") + text(352, 438, "Output") + text(324, 396, "Figure 2. Vector flow diagram");
  first += text(42, 100, "Open external link") + text(42, 80, "Second page has rotated CropBox coordinates.");
  add(stream(first));
  add(stream(text(60, 700, "Rotated page with a nonzero CropBox", 16) + text(60, 660, "Text and figures must remain anchored after rotation.") + "q 140 0 0 100 70 480 cm /Im1 Do Q\n0 0 1 RG 300 450 130 100 re S\n" + text(320, 495, "Vector box")));
  // ASCIIHex keeps offsets byte-stable and still decodes an actual 2x2 RGB image.
  add(stream("ff000000ff000000ffffff00>", "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode"));
  add("<< /Type /Annot /Subtype /Link /Rect [42 96 155 112] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>");
  let pdf = "%PDF-1.7\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
