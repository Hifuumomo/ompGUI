import type { Math as MathNode, InlineMath } from "mdast-util-math";
import type { CompileContext } from "mdast-util-from-markdown";
import type { Construct, State, Token } from "micromark-util-types";
import type { Processor } from "unified";
import type {} from "remark-parse";
import { markdownLineEnding } from "micromark-util-character";
import { codes } from "micromark-util-symbol";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    latexMathText: "latexMathText";
    latexMathFlow: "latexMathFlow";
    latexMathData: "latexMathData";
  }
}

/** 在 Markdown 转义处理前识别 LaTeX 分隔符，不进入行内代码、代码块或链接目标。 */
function latexConstruct(flow: boolean): Construct {
  const tokenType = flow ? "latexMathFlow" : "latexMathText";
  return {
    name: tokenType,
    concrete: flow,
    tokenize(effects, ok, nok) {
      let closing: number;
      let dataOpen = true;
      const start: State = (code) => {
        effects.enter(tokenType);
        effects.enter("latexMathData");
        effects.consume(code);
        return opening;
      };
      const opening: State = (code) => {
        if (code !== codes.leftSquareBracket && (flow || code !== codes.leftParenthesis))
          return nok(code);
        closing = code === codes.leftParenthesis ? codes.rightParenthesis : codes.rightSquareBracket;
        effects.consume(code);
        return body;
      };
      const body: State = (code) => {
        if (code === codes.eof) return nok(code);
        if (markdownLineEnding(code)) {
          // 每个物理换行必须独立成 token，供 micromark 对齐列表／引用的分段流。
          if (dataOpen) effects.exit("latexMathData");
          dataOpen = false;
          effects.enter("lineEnding");
          effects.consume(code);
          effects.exit("lineEnding");
          return body;
        }
        if (!dataOpen) {
          effects.enter("latexMathData");
          dataOpen = true;
        }
        effects.consume(code);
        return code === codes.backslash ? afterBackslash : body;
      };
      const afterBackslash: State = (code) => {
        if (code === closing) {
          effects.consume(code);
          return afterClose;
        }
        // 双反斜杠是 TeX 换行或字面反斜杠，不能把第二个反斜杠误当作结束标记。
        if (code === codes.backslash) {
          effects.consume(code);
          return body;
        }
        return body(code);
      };
      const afterClose: State = (code) => {
        if (flow) {
          if (code === codes.space || code === codes.horizontalTab || code === codes.virtualSpace) {
            effects.consume(code);
            return afterClose;
          }
          // 块级公式必须独占剩余行；同一行还有正文时由行内解析器接管。
          if (code !== codes.eof && !markdownLineEnding(code)) return nok(code);
        }
        effects.exit("latexMathData");
        effects.exit(tokenType);
        return ok(code);
      };
      return start;
    },
  };
}

/** 将完整的分隔符 token 直接转成现有数学节点，避免 Markdown 解释公式内的星号、下划线及反斜杠。 */
function enterMath(this: CompileContext, token: Token) {
  const raw = this.sliceSerialize(token).trimEnd();
  const value = raw.slice(2, -2);
  const display = raw.startsWith("\\[");
  const code = {
    type: "element" as const,
    tagName: "code",
    properties: { className: ["language-math", display ? "math-display" : "math-inline"] },
    children: [{ type: "text" as const, value }],
  };
  const node: MathNode | InlineMath = token.type === "latexMathFlow"
    ? { type: "math", meta: null, value, data: { hName: "pre", hChildren: [code] } }
    : { type: "inlineMath", value, data: { hName: "code", hProperties: code.properties, hChildren: code.children } };
  this.enter(node, token);
  this.buffer();
}

/** 结束当前数学节点；公式正文已由完整 token 原样提取。 */
function exitMath(this: CompileContext, token: Token) {
  this.resume();
  this.exit(token);
}

/** 补充标准 LaTeX 的行内 \(…\) 与块级 \[…\]，继续复用 remark-math 的美元分隔符。 */
export function remarkLatexMath(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    flow: { [codes.backslash]: latexConstruct(true) },
    text: { [codes.backslash]: latexConstruct(false) },
  });
  (data.fromMarkdownExtensions ??= []).push({
    enter: { latexMathFlow: enterMath, latexMathText: enterMath },
    exit: { latexMathFlow: exitMath, latexMathText: exitMath },
  });
}
