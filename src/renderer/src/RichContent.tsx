import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  isValidElement,
} from "react";
import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import katex from "katex";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import type { Mermaid } from "mermaid";
import type {} from "../../shared/protocol";
import "katex/dist/katex.min.css";
import "./rich-content.css";
import { messageFilePath } from "../../shared/message-file-link";
import { MessageFileLinks } from "./MessageFileLinks";
import { remarkFileMentions } from "./remark-file-mentions";
import { SafeLink } from "./FileReferenceLink";
import { remarkLatexMath } from "./remark-latex-math";
import { rehypeMathControls } from "./rehype-math-controls";
import { MathFormula } from "./MathFormula";
import { copyRichSelection } from "./rich-selection";

const remarkPlugins = [remarkGfm, remarkCjkFriendly, remarkMath, remarkLatexMath];
const fileMentionPlugins = [...remarkPlugins, remarkFileMentions];
const rehypePlugins: NonNullable<
  Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]
> = [rehypeMathControls, [rehypeKatex, { trust: false, strict: "warn", throwOnError: false }]];
let mermaidEngine: Promise<Mermaid> | undefined;
let diagramSequence = 0;

const piePalette = [
  "#8eaaf5",
  "#70cbb0",
  "#e9bb74",
  "#cc95e2",
  "#e88fa5",
  "#7cc6df",
] as const;

// Only application-owned CSS enters the isolated preview; diagram-provided styles never do.
const svgTheme = `
:host { display: block; color: #dce5f4; color-scheme: dark; }
svg { display: block; max-width: none; height: auto; margin: 0 auto; fill: #8eaaf5; font-family: system-ui, sans-serif; }
svg:not([width]) { width: 100%; min-width: 280px; }
text, tspan { fill: #dce5f4; }
.flowchart .label text { text-anchor: middle; }
.node rect, .node polygon, .node circle, .node ellipse, .cluster rect,
.actor, .labelBox { fill: #26334a; stroke: #93a8d0; }
.flowchart-link, .edgePath path, .messageLine0, .messageLine1,
.line-plot path { fill: none; stroke: #9fb8e8; stroke-width: 2; }
.marker, marker path { fill: #9fb8e8; stroke: #9fb8e8; }
.edgeLabel rect, .labelBkg { fill: #192234; }
circle.pieCircle { fill: none; stroke: #7285a6; }
path.pieCircle { stroke: #192234; stroke-width: 2; }
.bar-plot rect { fill: #8eaaf5; }
`;

/**
 * Remove executable SVG markup, embedded CSS, and nonlocal resources, then apply app-owned pie colors.
 * @param source [in] Untrusted SVG source from a fence or Mermaid output.
 * @returns A sanitized SVG element with matching pie slice/legend fills in an inert XML document; throws for invalid SVG.
 */
function sanitizeSvg(source: string): SVGSVGElement {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      "script",
      "foreignObject",
      "style",
      "image",
      "feImage",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "mpath",
    ],
    FORBID_ATTR: ["style", "src"],
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = parsed.documentElement;
  if (
    parsed.querySelector("parsererror") ||
    svg.localName !== "svg" ||
    svg.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    throw new Error("SVG 尚未完整或格式无效。");
  }

  // A second explicit pass excludes event handlers and resource URLs, even if a sanitizer policy changes.
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "src" ||
        (name === "href" && !/^#[\w:.-]+$/.test(value)) ||
        (/url\s*\(/i.test(value) &&
          !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/i.test(value))
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  // SVG links must not navigate the Electron window, even when their target is only a fragment.
  for (const link of svg.querySelectorAll("a"))
    link.replaceWith(...link.childNodes);
  // Match Mermaid's ordered slices and legend swatches directly; unrelated siblings cannot shift category colors.
  const slices = svg.querySelectorAll("path.pieCircle");
  const legends = svg.querySelectorAll("g.legend rect");
  for (let index = 0; index < slices.length; index++) {
    const fill = piePalette[index % piePalette.length];
    slices[index].setAttribute("fill", fill);
    legends.item(index)?.setAttribute("fill", fill);
  }
  return svg as unknown as SVGSVGElement;
}

/**
 * Load and configure the real Mermaid renderer once with nonoverridable strict security.
 * 参数：无。
 * @returns The shared, initialized Mermaid engine promise.
 */
function getMermaid() {
  /** Configure the imported engine. @param module [in] Mermaid module. @returns Strict renderer. */
  function configure(module: { default: Mermaid }) {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      theme: "dark",
      fontFamily: "system-ui, sans-serif",
      // 使用原生尺寸，避免净化移除 max-width 样式后将窄流程图放大至整栏。
      flowchart: { htmlLabels: false, useMaxWidth: false },
      dompurifyConfig: {
        FORBID_TAGS: ["image", "img", "style", "foreignObject"],
        FORBID_ATTR: ["src", "style"],
      },
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "htmlLabels",
        "flowchart",
        "theme",
        "themeCSS",
        "themeVariables",
        "fontFamily",
        "dompurifyConfig",
        "suppressErrorRendering",
        "maxTextSize",
      ],
    });
    return module.default;
  }
  mermaidEngine ??= import("mermaid").then(configure);
  return mermaidEngine;
}

/**
 * Exclude resource-bearing or configuration syntax before Mermaid creates its temporary layout DOM.
 * @param source [in] Untrusted Mermaid fence text.
 * @returns Whether source uses an unsupported potentially active/resource-bearing feature.
 */
function hasUnsafeMermaidFeatures(source: string): boolean {
  // Normalize CSS escapes/comments for inspection so classDef cannot hide a resource-bearing declaration.
  const inspected = source
    .replace(
      /\\([0-9a-f]{1,6})\s?/gi,
      /** Decode CSS escapes. @param match [in] Escape token. @param hex [in] Hex codepoint. @returns Decoded character. */
      (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Mermaid 将无属性的换行标记转换为 SVG 文本；其他 HTML 仍须拦截。
    .replace(/<br\s*\/?>/gi, "");
  return /%%\s*\{|^\s*---|<\s*[a-z!/]|@\s*import|(?:url|image-set)\s*\(|@\{[^}]*\bimg\s*:/im.test(
    inspected,
  );
}

/**
 * Mount only sanitized SVG into a shadow root, preventing SVG identifiers/styles from leaking into the app.
 * @param props [in] Sanitized SVG element to display.
 * @returns An isolated diagram preview that hands vertical boundary scrolling to its parent.
 */
function SvgPreview({ svg }: { svg: SVGSVGElement }) {
  const host = useRef<HTMLDivElement>(null);
  /** 挂载净化后的图形，并在滚动边界显式交接滚轮；卸载时移除监听。 */
  function mountSvg() {
    const preview = host.current!;
    const shadow = preview.shadowRoot ?? preview.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = svgTheme;
    shadow.replaceChildren(style, document.importNode(svg, true));
    /** 图内仍可滚动时保留原生行为；到边界后交给最近可滚动祖先，避免滚轮滞留。 */
    function chainWheel(event: WheelEvent) {
      if (
        event.defaultPrevented || !event.cancelable ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) return;
      const downward = event.deltaY > 0;
      // scrollTop 可带小数，scrollHeight/clientHeight 则取整，边界需要 1px 容差。
      if (downward
        ? preview.scrollHeight - preview.clientHeight - preview.scrollTop > 1
        : preview.scrollTop > 1
      ) return;
      for (let parent = preview.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          const available = downward
            ? parent.scrollHeight - parent.clientHeight - parent.scrollTop
            : parent.scrollTop;
          if (available > 1) {
            const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? parent.clientHeight
              : event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? parseFloat(getComputedStyle(preview).lineHeight) || 16
                : 1;
            const previous = parent.scrollTop;
            parent.scrollTop += event.deltaY * unit;
            if (parent.scrollTop !== previous) event.preventDefault();
            return;
          }
        }
        // 旁问等独立阅读区仍保留自己的滚动隔离边界，不穿透到更外层。
        if (
          style.overscrollBehaviorY !== "auto" &&
          style.overflowY !== "visible" && style.overflowY !== "clip"
        ) return;
      }
    }
    preview.addEventListener("wheel", chainWheel, { passive: false });
    return () => preview.removeEventListener("wheel", chainWheel);
  }
  useEffect(mountSvg, [svg]);
  return (
    <div
      className="rich-diagram-preview"
      role="img"
      aria-label="图表预览"
      ref={host}
    />
  );
}

/**
 * Display highlighted, escaped source with an explicit clipboard action and honest errors.
 * @param props [in] Source text and its optional language label.
 * @returns A syntax-highlighted source panel; no source is executed.
 */
function SourceBlock({
  source,
  language,
}: {
  source: string;
  language: string;
}) {
  const [copied, setCopied] = useState<{ source: string; label: string }>();
  // 流式输出会改变 source；旧结果只对当时复制的内容有效，内容变化后回到初始文案。
  const copyState = copied?.source === source ? copied.label : "复制";
  /** Compute escaped highlighting. 参数：无。 @returns Highlight.js HTML, or null for plain text. */
  function highlightSource() {
    return language && hljs.getLanguage(language)
      ? hljs.highlight(source, { language, ignoreIllegals: true }).value
      : null;
  }
  const highlighted = useMemo(highlightSource, [source, language]);
  /** Copy exact visible source through the main-process clipboard, which needs no Web Clipboard permission. 参数：无。 @returns Clipboard operation completion. */
  async function copySource() {
    const copiedSource = source;
    try {
      await window.desktop.copyText(copiedSource);
      setCopied({ source: copiedSource, label: "已复制" });
    } catch (error) {
      setCopied({
        source: copiedSource,
        label: `复制失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return (
    <div className="rich-source">
      <div className="rich-source-toolbar">
        <span>{language || "文本"}</span>
        <button type="button" onClick={copySource}>
          {copyState}
        </button>
      </div>
      <pre className="rich-code">
        <code
          {...(highlighted === null
            ? {}
            : { dangerouslySetInnerHTML: { __html: highlighted } })}
        >
          {highlighted === null ? source : undefined}
        </code>
      </pre>
    </div>
  );
}

/**
 * Render a static SVG or real Mermaid diagram while keeping pending/invalid streaming source readable.
 * @param props [in] The exact fence source and diagram language.
 * @returns Diagram preview with source disclosure, or visible source plus rendering error.
 */
function DiagramBlock({
  source,
  language,
}: {
  source: string;
  language: "svg" | "mermaid";
}) {
  const [result, setResult] = useState<{
    source: string;
    svg?: SVGSVGElement;
    error?: string;
  }>();
  /** Render the current streaming snapshot. 参数：无。 @returns Cleanup that discards obsolete results. */
  function renderSnapshot() {
    let cancelled = false;
    /** Parse the current source securely. 参数：无。 @returns Rendering completion. */
    async function renderDiagram() {
      let layoutHost: HTMLDivElement | undefined;
      try {
        let output = source;
        if (language === "mermaid") {
          if (hasUnsafeMermaidFeatures(source)) {
            throw new Error(
              "为安全起见，不预览含 HTML、图片、外部样式或自定义配置的 Mermaid；源码仍可查看。",
            );
          }
          const engine = await getMermaid();
          if (cancelled) return;
          // Layout needs a real DOM, but no untrusted resources/configuration enter this temporary host.
          layoutHost = document.createElement("div");
          layoutHost.className = "rich-diagram-layout";
          document.body.append(layoutHost);
          const rendered = await engine.render(
            `rich-diagram-${++diagramSequence}`,
            source,
            layoutHost,
          );
          output = rendered.svg;
          // Never bind Mermaid click handlers or callbacks into the desktop application.
        }
        const svg = sanitizeSvg(output);
        if (!cancelled) setResult({ source, svg });
      } catch (error) {
        if (!cancelled)
          setResult({
            source,
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        layoutHost?.remove();
      }
    }
    void renderDiagram();
    /** Discard an obsolete streaming render. 参数：无。 @returns 返回值：无。 */
    function cancelRender() {
      cancelled = true;
    }
    return cancelRender;
  }
  useEffect(renderSnapshot, [source, language]);
  const current = result?.source === source ? result : undefined;
  return (
    <div className="rich-diagram">
      {current?.svg && <SvgPreview svg={current.svg} />}
      {!current?.svg && (
        <div className="rich-diagram-notice" role="status">
          {current?.error
            ? `无法预览：${current.error}`
            : "图表生成中；未完成的源码如下。"}
        </div>
      )}
      {current?.svg ? (
        <details className="rich-source-disclosure">
          <summary>查看 {language} 源码</summary>
          <SourceBlock source={source} language={language} />
        </details>
      ) : (
        <SourceBlock source={source} language={language} />
      )}
    </div>
  );
}


const latexFences = new Set(["latex", "tex", "katex"]);

/**
 * Strip one outer $$…$$ or \[…\] wrapper and an equation/equation* shell, and drop \label, which KaTeX lacks.
 * @param source [in] Exact fence text.
 * @returns TeX body for KaTeX; empty when nothing remains.
 */
function latexBody(source: string): string {
  const wrapped = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])$/.exec(source.trim());
  const inner = (wrapped?.[1] ?? wrapped?.[2] ?? source).trim();
  const shell = /^\\begin\{(equation\*?)\}([\s\S]*)\\end\{\1\}$/.exec(inner);
  return (shell?.[2] ?? inner).replace(/\\label\{[^{}]*\}/g, "").trim();
}

/**
 * Try to render a latex/tex fence as a display formula; keep the highlighted source when KaTeX rejects it.
 * @param props [in] The exact fence source and its language label.
 * @returns A toggleable formula, or the original source block.
 */
function LatexBlock({ source, language }: { source: string; language: string }) {
  /** Render strictly so any parse error is detected. 参数：无。 @returns KaTeX HTML, or undefined when it cannot be rendered. */
  function renderTex() {
    const tex = latexBody(source);
    if (!tex) return undefined;
    try {
      return katex.renderToString(tex, {
        displayMode: true,
        throwOnError: true,
        trust: false,
        strict: "ignore",
      });
    } catch {
      return undefined;
    }
  }
  const html = useMemo(renderTex, [source]);
  if (html === undefined) return <SourceBlock source={source} language={language} />;
  return (
    <MathFormula source={source}>
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </MathFormula>
  );
}

/**
 * Select source/diagram rendering for a Markdown fence without interfering with inline code or math.
 * @param props [in] The Markdown pre element's children.
 * @returns Safe code rendering, or a semantic pre element when not a code fence.
 */
function MarkdownPre({ children }: { children?: ReactNode }) {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
    return <pre>{children}</pre>;
  const language =
    /(?:^|\s)language-([\w+-]+)/
      .exec(children.props.className ?? "")?.[1]
      .toLowerCase() ?? "";
  const source = String(children.props.children ?? "").replace(/\n$/, "");
  if (language === "mermaid" || language === "svg")
    return <DiagramBlock source={source} language={language} />;
  if (latexFences.has(language))
    return <LatexBlock source={source} language={language} />;
  return <SourceBlock source={source} language={language} />;
}

/**
 * Replace Markdown images with their description without requesting remote or local resources.
 * @param props [in] Author-provided image description.
 * @returns An inert image placeholder.
 */
function BlockedImage({ alt }: { alt?: string }) {
  return (
    <span className="rich-blocked-image">
      [图片未加载{alt ? `：${alt}` : ""}；已禁用内容中的图片请求]
    </span>
  );
}

const markdownComponents: Components = {
  a: SafeLink,
  pre: MarkdownPre,
  img: BlockedImage,
  span: ({ node, children, ...props }) => {
    const source = node?.properties.dataMathSource;
    return typeof source === "string" ? (
      <MathFormula source={source}>
        {children}
      </MathFormula>
    ) : (
      <span {...props}>{children}</span>
    );
  },
};

/** 保留可解析的文件地址交给点击处理；其他协议仍由 Markdown 默认规则过滤。 */
function messageUrlTransform(url: string): string {
  return messageFilePath(url) !== undefined ? url : defaultUrlTransform(url);
}

/** 文件侧栏 Markdown 预览复用消息渲染管线；调用方可覆盖图片组件。 */
export const richMarkdown = {
  remarkPlugins,
  rehypePlugins,
  components: markdownComponents,
  urlTransform: messageUrlTransform,
} as const;

/**
 * Render streaming native-session Markdown with GFM, bundled KaTeX, highlighted code and safe diagrams.
 * @param props [in] text: Current complete Markdown snapshot; changing it re-renders the real content.
 * @returns Rich content without raw HTML execution, remote image tracking or local-command links.
 */
export const RichContent = memo(function RichContent({
  text,
}: {
  text: string;
}) {
  const openFile = useContext(MessageFileLinks);
  return (
    <div className="rich-content" onCopy={(event) => copyRichSelection(event.nativeEvent, event.currentTarget)}>
      <ReactMarkdown
        remarkPlugins={openFile ? fileMentionPlugins : remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        urlTransform={messageUrlTransform}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
