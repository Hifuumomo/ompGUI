import { expect, it } from "vitest";
import { PROMPT_CONTEXT_IMAGE_LIMIT, validatePromptContext, validatePromptContextImage, type PromptContextImage } from "./prompt-context";

const png: PromptContextImage = { mimeType: "image/png", width: 1, height: 1, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=" };
it("accepts PNG headers and rejects MIME, signature, IHDR dimensions and malformed base64", () => {
  expect(() => validatePromptContextImage(png)).not.toThrow();
  for (const image of [
    { ...png, mimeType: "image/jpeg" }, { ...png, width: 2 }, { ...png, height: 0 },
    { ...png, width: 4097 }, { ...png, width: 4096, height: 4096 },
    { ...png, data: `data:image/png;base64,${png.data}` }, { ...png, data: png.data.slice(1) },
    { ...png, data: "AAAA" + png.data.slice(4) }, { ...png, data: png.data.replace("SUhEUg", "QUJDRA") },
    { ...png, data: "AAAA".repeat(Math.ceil(PROMPT_CONTEXT_IMAGE_LIMIT / 3) + 1) },
  ]) expect(() => validatePromptContextImage(image as PromptContextImage)).toThrow();
});
it("requires real figure/region images, nonempty paragraph/text and legal one-based PDF sources", () => {
  const base = { kind: "pdf" as const, url: "https://example.test/paper", title: "论文", page: 1, selection: "figure" as const, text: "", image: png };
  expect(() => validatePromptContext(base)).not.toThrow();
  expect(() => validatePromptContext({ ...base, image: undefined })).toThrow();
  expect(() => validatePromptContext({ ...base, selection: "region", image: undefined })).toThrow();
  expect(() => validatePromptContext({ ...base, selection: "paragraph" })).toThrow();
  expect(() => validatePromptContext({ ...base, selection: "text" })).toThrow();
  expect(() => validatePromptContext({ ...base, page: 0 })).toThrow();
  expect(() => validatePromptContext({ ...base, page: 1.5 })).toThrow();
  expect(() => validatePromptContext({ ...base, url: "file:///tmp/a.pdf" })).toThrow();
  expect(() => validatePromptContext({ ...base, text: "甲".repeat(65537) })).toThrow();
  expect(() => validatePromptContext({ kind: "web-region", url: base.url, title: "页面", image: png })).not.toThrow();
});
