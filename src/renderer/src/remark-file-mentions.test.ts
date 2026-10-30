import { expect, it } from "vitest";
import { remarkFileMentions } from "./remark-file-mentions";

function convert(value: string, type = "inlineCode") {
  const node = { type: "root", children: [{ type, value }] };
  remarkFileMentions()(node);
  return node.children[0];
}

it.each([
  "D:\\Game\\866_彩铅教程6_解包\\",
  "C:\\",
  "D:\\目录 空格\\无后缀文件",
  "D:\\目录\\100%#完成\\",
])("识别 Windows 绝对路径 %s", (value) => {
  expect(convert(value).type).toBe("link");
});

it.each([
  "/help",
  "/api/users",
  "/abc/",
  "a/b",
  "console.log",
  "object.current",
  "D:relative",
  "D:/目录/",
  "run D:\\目录\\",
  "D:\\a*",
  "D:\\a:stream",
  "D:\\a\u0000",
  "\\\\server\\目录\\",
])("不扩大识别范围 %s", (value) => {
  expect(convert(value).type).toBe("inlineCode");
});

it("数学公式和代码块保持原样", () => {
  expect(convert("D:\\目录\\", "inlineMath").type).toBe("inlineMath");
  expect(convert("D:\\目录\\", "code").type).toBe("code");
});

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

/** 验证引用保留原始标签、尾标点及字面文件名。参数：无。@returns 返回值：无。 */
function explicitReferences() {
  const root: MarkdownNode = {
    type: "root",
    children: [{ type: "text", value: '查看 @src/main.ts, @"assets/100%# photo.png"。' }],
  };
  remarkFileMentions()(root);
  expect(root.children).toEqual([
    { type: "text", value: "查看 " },
    { type: "link", url: "src/main.ts", children: [{ type: "text", value: "@src/main.ts" }] },
    { type: "text", value: ", " },
    { type: "link", url: "assets/100%25%23%20photo.png", children: [{ type: "text", value: '@"assets/100%# photo.png"' }] },
    { type: "text", value: "。" },
  ]);
}
it("转换完整正文引用，保留标签和尾标点并复用字面路径编码", explicitReferences);

/** 验证普通文字、邮箱、未闭合引用、空路径和代码不被正文解析器改写。参数：无。@returns 返回值：无。 */
function inertContent() {
  const children: MarkdownNode[] = [
    { type: "text", value: 'plain.ts dev@example.com @"" @"unfinished path' },
    { type: "code", value: "@src/fenced.ts" },
    { type: "inlineMath", value: "@src/math.ts" },
    { type: "link", url: "src/existing.ts", children: [{ type: "text", value: "@src/label.ts" }] },
    { type: "linkReference", children: [{ type: "text", value: "@src/reference.ts" }] },
  ];
  const root: MarkdownNode = { type: "root", children };
  remarkFileMentions()(root);
  expect(root.children).toEqual(children);
}
it("普通路径、邮箱、未闭合引用、代码、公式和现有链接保持原样", inertContent);

/** 验证不把显式 @外链或设备地址提升为可点击路径。参数：无。@returns 返回值：无。 */
function unsupportedTargets() {
  const root: MarkdownNode = { type: "root", children: [{ type: "text", value: "@https://example.com/a.png @javascript:alert(1)" }] };
  remarkFileMentions()(root);
  expect(root.children?.every(
    /** 判断节点保持为正文。@param node [in] 转换结果节点。@returns 是否为纯文本。 */
    (node) => node.type === "text",
  )).toBe(true);
}
it("不将 @外链转换成文件或网页链接", unsupportedTargets);
