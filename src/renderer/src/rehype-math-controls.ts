import type { Element, Root, RootContent } from "hast";
import type { VFile } from "vfile";

/** 仅识别数学插件或显式 math 代码块生成的节点，不把普通代码当作公式。 */
function mathCode(node: RootContent): Element | undefined {
  return node.type === "element" && node.tagName === "code" &&
    Array.isArray(node.properties.className) &&
    node.properties.className.some((name) => name === "language-math" || name === "math-inline" || name === "math-display")
    ? node : undefined;
}

/** 仅为行间公式保留源码和交互容器；行内公式直接由 KaTeX 渲染，不附加操作。 */
export function rehypeMathControls() {
  return (tree: Root, file: VFile) => {
    const markdown = String(file.value);
    function visit(parent: Root | Element) {
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        const code = mathCode(child) ?? (
          child.type === "element" && child.tagName === "pre" && child.children[0]
            ? mathCode(child.children[0]) : undefined
        );
        if (code) {
          const display = child !== code || (code.properties.className as string[]).includes("math-display");
          if (!display) continue;
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          const source = start !== undefined && end !== undefined
            ? markdown.slice(start, end)
            : code.children.map((part) => part.type === "text" ? part.value : "").join("");
          parent.children[index] = {
            type: "element",
            tagName: "span",
            properties: {
              className: ["rich-math-container"],
              dataMathSource: source,
            },
            children: [child as Element],
          };
        } else if (child.type === "element") {
          visit(child);
        }
      }
    }
    visit(tree);
  };
}
