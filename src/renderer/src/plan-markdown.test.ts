import { afterEach, describe, expect, it } from "vitest";
import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { PlanMarkdownSource, assertPlanSize, planRawBlock, protectPlanTree } from "./plan-markdown";

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map((editor) => editor.destroy())); document.body.replaceChildren(); });
async function fixture(markdown: string) {
  const source = new PlanMarkdownSource(markdown);
  const root = document.createElement("div"); document.body.append(root);
  const editor = Editor.make().config((ctx) => { ctx.set(rootCtx, root); ctx.set(defaultValueCtx, markdown); })
    .use(commonmark).use(gfm).use(source.math).use(source.remark).use(planRawBlock);
  editors.push(editor);
  await editor.create();
  editor.action((ctx) => source.capture(ctx.get(editorViewCtx).state.doc));
  return {
    editor,
    serialize: () => editor.action((ctx) => source.serialize(ctx.get(editorViewCtx).state.doc, ctx.get(serializerCtx))),
    replace: (search: string, replacement: string) => editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let position = -1;
      view.state.doc.descendants((node, offset) => { if (position < 0 && node.isText && node.text?.includes(search)) position = offset + node.text.indexOf(search); });
      if (position < 0) throw new Error(`Missing text: ${search}`);
      view.dispatch(view.state.tr.insertText(replacement, position, position + search.length));
    }),
  };
}

describe("plan Markdown source fidelity", () => {
  it.each([
    "\uFEFF# 中文😀\r\n\r\n正文\r\n",
    "# No trailing newline\n\n- a\n  - b",
    "---\ntitle: 标题\n---\n\n# 正文\n\n<!-- keep -->\n\n[x]: https://example.com \"标题\"\n\n[x]\n",
    "$$\nx^2\n$$\n\n:::unknown\n原样\n:::\n\n```mermaid\ngraph TD; A-->B\n```\n",
    "| A | B |\n| - | - |\n| 中文 | `a` |\n\n> 引用\n\n- [x] 完成\n",
    "",
  ])("returns unedited original bytes: %s", async (markdown) => {
    const doc = await fixture(markdown);
    expect(doc.serialize()).toBe(markdown);
  });
  it("parses a lone CRLF heading without including its document terminator", async () => {
    const doc = await fixture("# 第二份\r\n");
    doc.editor.action((ctx) => expect(ctx.get(editorViewCtx).state.doc.child(0).textContent).toBe("第二份"));
    expect(doc.serialize()).toBe("# 第二份\r\n");
  });
  it("edits standard blocks without normalizing surrounding raw/source blocks", async () => {
    const markdown = "\uFEFF# 标题\r\n\r\n执行项A\r\n\r\n<!-- 保留注释 -->\r\n\r\n[x]: https://example.com\r\n\r\n[x]\r\n\r\n$$\r\nx^2\r\n$$\r\n\r\n```svg\r\n<svg />\r\n```\r\n";
    const doc = await fixture(markdown);
    doc.replace("执行项A", "执行项B😀");
    expect(doc.serialize()).toBe(markdown.replace("执行项A", "执行项B😀"));
  });
  it.each(["\n", "\r\n"])("preserves original block boundaries and heading bytes when editing with %j", async (newline) => {
    const markdown = "\uFEFF## 标题😀  ##\n\n\n执行项A\n\n\n<!-- 原样 -->\n\n```ts\nconst a = `中文`;\n```\n\n".replace(/\n/g, newline);
    const doc = await fixture(markdown);
    doc.editor.action((ctx) => {
      expect(ctx.get(editorViewCtx).state.doc.child(0).textContent).toBe("标题😀");
    });
    doc.replace("执行项A", "执行项B");
    expect(doc.serialize()).toBe(markdown.replace("执行项A", "执行项B"));
  });
  it("keeps untouched CRLF raw blocks and separators when changing the first and last standard blocks", async () => {
    const markdown = "\uFEFF# 标题\r\n\r\n\r\n<!-- 原样\r\n注释 -->\r\n\r\n结尾";
    const doc = await fixture(markdown);
    doc.replace("标题", "新标题");
    doc.replace("结尾", "新结尾😀");
    expect(doc.serialize()).toBe(markdown.replace("标题", "新标题").replace("结尾", "新结尾😀"));
  });
  it("does not execute HTML or discard unknown smallest top-level blocks", () => {
    const markdown = "<!--keep-->\n\nregular";
    const tree = { type: "root", children: [
      { type: "html", value: "<!--keep-->", position: { start: { offset: 0 }, end: { offset: 11 } } },
      { type: "paragraph", children: [{ type: "text", value: "regular" }], position: { start: { offset: 13 }, end: { offset: 20 } } },
    ] };
    const blocks = protectPlanTree(tree, markdown);
    expect(tree.children[0].type).toBe("planRaw");
    expect(tree.children[1].type).toBe("paragraph");
    expect(blocks.map((block) => block.before + block.source).join("")).toBe(markdown);
  });
  it("serializes split/merged standard blocks rather than reusing stale source", async () => {
    const doc = await fixture("# Heading\n\nalpha beta\n\n<!--raw-->\n");
    doc.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const replacement = ctx.get(parserCtx)("alpha\n\nbeta");
      const first = view.state.doc.child(0).nodeSize;
      view.dispatch(view.state.tr.replaceWith(first, first + view.state.doc.child(1).nodeSize, replacement.content));
    });
    const serialized = doc.serialize();
    expect(serialized).toContain("alpha\n\nbeta");
    expect(serialized).toContain("<!--raw-->");
    expect(serialized).not.toContain("alpha beta");
  });
  it("enforces UTF-8 bytes rather than UTF-16 code units", () => {
    expect(() => assertPlanSize("a".repeat(1024 * 1024))).not.toThrow();
    expect(() => assertPlanSize("a".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
    expect(() => assertPlanSize("中".repeat(400000))).toThrow("1 MiB");
  });
});
