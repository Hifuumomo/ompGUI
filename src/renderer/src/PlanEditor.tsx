import { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Slice } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { messageFilePath } from "../../shared/message-file-link";
import { WebLinks } from "./WebLinks";
import { MessageFileLinks } from "./MessageFileLinks";
import { PlanMarkdownSource, assertPlanSize, planHeadings, planRawBlock } from "./plan-markdown";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./plan-panel.css";

export interface PlanEditorHandle { flush(): string; focus(): void }
export interface PlanEditorProps {
  documentKey: string;
  value: string;
  readOnly: boolean;
  onDirty: () => void;
  onChange: (markdown: string) => void;
  onSave: () => void;
}

/** 文档键控制撤销历史；普通受控回声不会重建编辑器。 */
export const PlanEditor = forwardRef<PlanEditorHandle, PlanEditorProps>(function PlanEditor(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | undefined>(undefined);
  const source = useRef<PlanMarkdownSource | undefined>(undefined);
  const callbacks = useRef(props);
  callbacks.current = props;
  const openWeb = useContext(WebLinks);
  const openFile = useContext(MessageFileLinks);
  const routes = useRef({ openWeb, openFile });
  routes.current = { openWeb, openFile };
  const composing = useRef(false);
  const dirty = useRef(false);
  const lastPublished = useRef(props.value);
  const timer = useRef<number | undefined>(undefined);
  const reloading = useRef(false);
  const flushRef = useRef<() => string>(() => { throw new Error("计划编辑器尚未准备好"); });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  flushRef.current = () => {
    if (composing.current) throw new Error("请先完成中文输入，再保存或处置计划");
    clearTimeout(timer.current);
    if (!editor.current || !source.current) throw new Error(error || "计划编辑器尚未准备好");
    try {
      const value = editor.current.action((ctx) => source.current!.serialize(ctx.get(editorViewCtx).state.doc, ctx.get(serializerCtx)));
      if (value !== lastPublished.current) {
        lastPublished.current = value;
        callbacks.current.onChange(value);
      }
      dirty.current = false;
      setError("");
      return value;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      throw failure;
    }
  };
  useImperativeHandle(ref, () => ({
    flush: () => flushRef.current(),
    focus: () => { editor.current?.action((ctx) => ctx.get(editorViewCtx).focus()); },
  }), []);

  useEffect(() => {
    let disposed = false;
    setReady(false);
    setError("");
    dirty.current = false;
    composing.current = false;
    const initial = callbacks.current.value;
    lastPublished.current = initial;
    // 每代 Editor 独占挂载点，旧实例异步销毁不能触碰新文档的 DOM。
    const mount = document.createElement("div");
    root.current?.replaceChildren(mount);
    let instance: Editor | undefined;
    try {
      assertPlanSize(initial);
      const preservation = new PlanMarkdownSource(initial);
      source.current = preservation;
      instance = Editor.make().config((ctx) => {
        ctx.set(rootCtx, mount);
        ctx.set(defaultValueCtx, initial);
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          editable: () => !callbacks.current.readOnly,
          attributes: { role: "textbox", "aria-multiline": "true", "aria-label": "计划正文（可直接编辑）", spellcheck: "false" },
          nodeViews: {
            image: (node) => {
              const dom = document.createElement("span");
              dom.className = "plan-image-placeholder";
              dom.contentEditable = "false";
              dom.setAttribute("role", "img");
              dom.setAttribute("aria-label", String(node.attrs.alt || "图片"));
              dom.textContent = `▧ ${String(node.attrs.alt || "图片")} · ${String(node.attrs.src)}`;
              dom.title = String(node.attrs.title || node.attrs.src);
              return { dom };
            },
          },
          handlePaste: (view, event) => {
            event.preventDefault();
            if (callbacks.current.readOnly) return true;
            const html = event.clipboardData?.getData("text/html");
            const template = document.createElement("template");
            if (html) template.innerHTML = html;
            const text = event.clipboardData?.getData("text/markdown") || event.clipboardData?.getData("text/plain")
              || template.content.textContent || "";
            if (!text) return true;
            try {
              assertPlanSize(text);
              const doc = ctx.get(parserCtx)(text);
              view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
            } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
            return true;
          },
          handleDOMEvents: {
            // ProseMirror 会在 compositionend 后暂时跳过 handleKeyDown；保存由原生 DOM 事件处理。
            keydown: (_view, event) => {
              if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return false;
              event.preventDefault(); event.stopPropagation();
              if (!callbacks.current.readOnly && !event.isComposing) {
                try { flushRef.current(); callbacks.current.onSave(); } catch { /* 保存错误保留缓冲。 */ }
              }
              return true;
            },
            click: (_view, event) => {
              const anchor = (event.target as Element | null)?.closest("a");
              if (!anchor) return false;
              event.preventDefault();
              if (!event.ctrlKey && !event.metaKey) return false;
              const href = anchor.getAttribute("href") ?? "";
              const route = /^https?:\/\//i.test(href) ? routes.current.openWeb
                : messageFilePath(href) !== undefined ? routes.current.openFile : undefined;
              if (route) void route(href).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
              return true;
            },
            compositionstart: () => { composing.current = true; clearTimeout(timer.current); return false; },
            compositionend: () => {
              composing.current = false;
              timer.current = window.setTimeout(() => { if (dirty.current) { try { flushRef.current(); } catch { /* 保留原文并由 aria-live 报错。 */ } } }, 0);
              return false;
            },
            blur: () => { if (dirty.current && !composing.current) { try { flushRef.current(); } catch { /* 失败时不发布空正文。 */ } } return false; },
            drop: (_view, event) => { event.preventDefault(); return true; },
          },
        }));
        ctx.get(listenerCtx).updated((_ctx, doc, previous) => {
          if (disposed || reloading.current || !previous || doc.eq(previous)) return;
          // 目录读取真实标题 DOM；无额外 React 状态或第二份文档。
          queueMicrotask(() => {
            if (disposed) return;
            const headings = planHeadings(doc);
            root.current?.querySelectorAll(".ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6").forEach((heading, index) => {
              if (headings[index]) heading.id = headings[index].id;
            });
          });
        });
      }).use(commonmark).use(gfm).use(history).use(clipboard).use(listener)
        .use(preservation.math).use(preservation.remark).use(planRawBlock)
        .use($prose(() => new Plugin({
          view: () => ({
            update(view, previous) {
              if (disposed || reloading.current || view.state.doc.eq(previous.doc)) return;
              dirty.current = true;
              callbacks.current.onDirty();
              clearTimeout(timer.current);
              if (!composing.current) timer.current = window.setTimeout(() => {
                try { flushRef.current(); } catch { /* 保留缓冲，禁止失败保存覆盖文件。 */ }
              }, 600);
            },
          }),
        })));
      const created = instance;
      void created.create().then(async () => {
        if (disposed) { await created.destroy(); return; }
        editor.current = created;
        created.action((ctx) => preservation.capture(ctx.get(editorViewCtx).state.doc));
        setReady(true);
      }).catch((failure: unknown) => { if (!disposed) setError(failure instanceof Error ? failure.message : String(failure)); });
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    return () => {
      disposed = true;
      clearTimeout(timer.current);
      if (instance && editor.current === instance) { editor.current = undefined; void instance.destroy().finally(() => mount.remove()); }
      source.current = undefined;
    };
  }, [props.documentKey]);

  useEffect(() => {
    if (ready) editor.current?.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => !props.readOnly }));
  }, [props.readOnly, ready]);

  useEffect(() => {
    if (!ready || !editor.current || props.value === lastPublished.current) return;
    // 只有明确外部重载会与最后发布值不同；尚有本地事务时拒绝覆盖。
    if (dirty.current || composing.current) { setError("计划有未保存修改，请先处理冲突再重新加载"); return; }
    try {
      assertPlanSize(props.value);
      reloading.current = true;
      try {
        editor.current.action((ctx) => {
          source.current!.prepare(props.value);
          const doc = ctx.get(parserCtx)(props.value);
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta("addToHistory", false));
          source.current!.capture(view.state.doc);
        });
        lastPublished.current = props.value;
        dirty.current = false;
        clearTimeout(timer.current);
      } finally { reloading.current = false; }
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [props.value, ready]);

  return <div className="plan-editor" aria-busy={!ready}>
    <div ref={root} className="plan-editor-root" />
    <div className="plan-editor-error" role="status" aria-live="polite">{error}</div>
  </div>;
});
