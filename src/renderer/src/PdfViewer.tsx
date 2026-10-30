import { useEffect, useRef, useState } from "react";
import type * as PdfCore from "pdfjs-dist";
import type * as PdfWeb from "pdfjs-dist/types/web/pdf_viewer.component";
import type { PDFDocumentProxy, PDFPageProxy, PDFDocumentLoadingTask, RenderTask, TextItem } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { PDFViewer as Viewer } from "pdfjs-dist/types/web/pdf_viewer";
import type { PdfViewerBridge, PdfViewerCommand, PdfViewerEvent, PdfPickRequest, PdfMarker, PdfViewportRect } from "../../shared/pdf-viewer";
import { validatePromptContextImage } from "../../shared/prompt-context";
import type { PromptContextImage } from "../../shared/prompt-context";
import { buildPdfSelectionBlocks, choosePdfBlock, clipPdfRect, pdfRectToViewport } from "./pdf-selection";
import type { PdfRect, PdfSelectionBlock, PdfTextItem, PdfGraphic } from "./pdf-selection";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

declare global { interface Window { pdfViewer: PdfViewerBridge } }
type WebModule = typeof PdfWeb;
interface PageAnalysis { blocks: PdfSelectionBlock[]; items: PdfTextItem[] }
interface LocalAnchor { anchorId: string; page: number; pageRect: PdfRect }
interface Drag { pointer: number; page: number; startX: number; startY: number; bounds: DOMRect; current: PdfViewportRect }
interface ReaderControls { page(n: number): void; zoom(factor: number): void; fit(): void; rotate(): void; find(query: string, previous?: boolean): void; thumbnails(open: boolean): void; password(value: string): void; cancelPassword(): void }

/** 页面内容只由授权 bytes 创建，外链只能发回 main，永远不在可信入口内导航。 */
export function PdfViewer({ core, web }: { core: typeof PdfCore; web: WebModule }) {
  const container = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), thumbs = useRef<HTMLElement>(null);
  const controls = useRef<ReaderControls | null>(null);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [thumbnails, setThumbnails] = useState(false);
  const [query, setQuery] = useState(""), [status, setStatus] = useState("正在加载 PDF…"), [password, setPassword] = useState<boolean | null>(null), [secret, setSecret] = useState("");
  useEffect(() => {
    const host = container.current!, layer = overlay.current!, thumbnailHost = thumbs.current!;
    const bus = new web.EventBus();
    const linkService = new web.PDFLinkService({ eventBus: bus });
    const findController = new web.PDFFindController({ eventBus: bus, linkService });
    const asset = (name: string) => new URL(`./pdf-assets/${name}/`, window.location.href).href;
    const viewer: Viewer = new web.PDFViewer({ container: host, viewer: pages.current!, eventBus: bus, linkService, findController, textLayerMode: 1, annotationMode: core.AnnotationMode.ENABLE, annotationEditorMode: core.AnnotationEditorType.NONE, imageResourcesPath: asset("web/images"), enableOptimizedPartialRendering: true, imagesRightClickMinSize: 16, maxCanvasPixels: 16 * 1024 * 1024, enableAutoLinking: false });
    linkService.setViewer(viewer);
    let documentId = "", doc: PDFDocumentProxy | null = null, loading: PDFDocumentLoadingTask | null = null, epoch = 0, visible = true, stopped = false, ready = false;
    let pick: PdfPickRequest | null = null, drag: Drag | null = null, markers: PdfMarker[] = [], revision = 0, selected: LocalAnchor | null = null, frame = 0, revealEpoch = 0, thumbnailOpen = false;
    let passwordCallback: ((value: string) => void) | null = null;
    let pendingHash: string | null = null;
    let workerCleanup: (() => void) | null = null;
    let initialView: { hash: string } | null = null;
    let pickTimeout: number | undefined;
    let suppressClick = false, hoverSequence = 0;
    const renderingQueue = viewer.renderingQueue;
    if (!renderingQueue) throw new Error("PDF 阅读器未创建渲染队列");
    const renderHighestPriority = renderingQueue.renderHighestPriority.bind(renderingQueue);
    renderingQueue.renderHighestPriority = (visiblePages) => { if (visible && !stopped) renderHighestPriority(visiblePages); };
    const analysis = new Map<number, Promise<PageAnalysis>>(), recordedViewport = new Map<number, PageViewport>(), renderTasks = new Set<RenderTask>();
    const thumbnailDone = new Set<number>();
    let thumbnailObserver: IntersectionObserver | null = null;
    const emit = (event: PdfViewerEvent) => window.pdfViewer.send(event);
    const report = (error: unknown) => setStatus(error instanceof Error ? error.message : String(error));
    const cancelPick = () => {
      window.clearTimeout(pickTimeout); pickTimeout = undefined;
      if (pick) emit({ type: "cancelled", documentId, requestId: pick.requestId });
      pick = null; drag = null; host.classList.remove("picking"); layer.querySelectorAll(".pdf-candidate,.pdf-drag").forEach(n => n.remove());
    };
    const cancelRenders = () => {
      for (const task of renderTasks) task.cancel(); renderTasks.clear();
      for (let i = 0; i < viewer.pagesCount; i++) {
        const pageView = viewer.getPageView(i);
        if (pageView && pageView.renderingState !== web.RenderingStates.FINISHED) pageView.reset({ keepAnnotationLayer: true, keepTextLayer: true, keepCanvasWrapper: true });
      }
    };
    const pageAt = (target: EventTarget | null): HTMLElement | null => target instanceof Element ? target.closest<HTMLElement>(".page[data-page-number]") : null;
    const pageContentRect = (element: HTMLElement): DOMRect => (element.querySelector<HTMLElement>(".canvasWrapper") ?? element.querySelector<HTMLElement>(".textLayer") ?? element).getBoundingClientRect();
    const announceReady = () => {
      if (ready || !doc || !visible || initialView) return;
      const pageView = viewer.getPageView(viewer.currentPageNumber - 1);
      if (!pageView || pageView.renderingState !== web.RenderingStates.FINISHED) return;
      const rect = pageContentRect(pageView.div), viewport = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= viewport.left || rect.left >= viewport.right || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return;
      ready = true;
      emit({ type: "ready", documentId, pages: doc.numPages });
    };
    const projection = (anchor: LocalAnchor): PdfViewportRect | undefined => {
      const view = viewer.getPageView(anchor.page - 1);
      if (!view?.pdfPage || !view.div.isConnected || !view.div.querySelector("canvas")) return undefined;
      const r = pdfRectToViewport(anchor.pageRect, view.viewport), box = pageContentRect(view.div);
      const rect = { x: box.left + Math.min(r[0]!, r[2]!), y: box.top + Math.min(r[1]!, r[3]!), width: Math.abs(r[2]! - r[0]!), height: Math.abs(r[3]! - r[1]!) };
      const viewport = host.getBoundingClientRect();
      return rect.x + rect.width > viewport.left && rect.x < viewport.right && rect.y + rect.height > viewport.top && rect.y < viewport.bottom ? rect : undefined;
    };
    const paintBox = (className: string, rect: PdfViewportRect, label?: string) => {
      const element = document.createElement("div"); element.className = className;
      Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      if (label) element.textContent = label; layer.append(element); return element;
    };
    const geometry = () => {
      frame = 0; if (!visible || !documentId) return;
      layer.querySelectorAll(".pdf-marker").forEach(n => n.remove());
      const anchors = markers.map(marker => {
        const rect = projection(marker);
        if (rect) {
          const button = document.createElement("button"); button.className = "pdf-marker"; button.textContent = `${marker.number}`; button.title = `评论${marker.number}`;
          Object.assign(button.style, { left: `${rect.x}px`, top: `${rect.y}px` });
          button.onclick = event => { if (event.isTrusted) emit({ type: "marker", documentId, revision, anchorId: marker.anchorId }); }; layer.append(button);
        }
        return { anchorId: marker.anchorId, rect };
      });
      if (selected && !markers.some(m => m.anchorId === selected!.anchorId)) anchors.push({ anchorId: selected.anchorId, rect: projection(selected) });
      emit({ type: "geometry", documentId, revision, anchors });
    };
    const scheduleGeometry = () => { if (visible && !frame) frame = requestAnimationFrame(geometry); };
    const regionPdfRect = (pageNumber: number, rect: PdfViewportRect): PdfRect => {
      const pv = viewer.getPageView(pageNumber - 1)!, box = pageContentRect(pv.div);
      const a = pv.viewport.convertToPdfPoint(rect.x - box.left, rect.y - box.top), b = pv.viewport.convertToPdfPoint(rect.x + rect.width - box.left, rect.y + rect.height - box.top);
      return [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!)];
    };
    const getAnalysis = (pageNumber: number): Promise<PageAnalysis> => {
      let pending = analysis.get(pageNumber); if (pending) return pending;
      const current = epoch, currentDoc = doc!;
      pending = (async () => {
        const pdfPage = await currentDoc.getPage(pageNumber), content = await pdfPage.getTextContent({ disableNormalization: true });
        const items: PdfTextItem[] = content.items.flatMap((item, index) => {
          if (!("str" in item)) return [];
          const t = item as TextItem, style = content.styles[t.fontName]!, tr = t.transform;
          const size = Math.hypot(tr[2]!, tr[3]!), angle = Math.atan2(tr[1]!, tr[0]!) + (style?.vertical ? Math.PI / 2 : 0), advance = style?.vertical ? t.height : t.width;
          const ascent = (style?.ascent ?? (1 + (style?.descent ?? -.2))) * size, descent = (style?.descent ?? -.2) * size;
          const corners = [[0, descent], [advance, descent], [0, ascent], [advance, ascent]].map(([x, y]) => [tr[4]! + x! * Math.cos(angle) - y! * Math.sin(angle), tr[5]! + x! * Math.sin(angle) + y! * Math.cos(angle)]);
          return [{ str: t.str, bbox: [Math.min(...corners.map(p => p[0]!)), Math.min(...corners.map(p => p[1]!)), Math.max(...corners.map(p => p[0]!)), Math.max(...corners.map(p => p[1]!))] as PdfRect, fontSize: size || t.height || 1, fontName: t.fontName, dir: t.dir, hasEOL: t.hasEOL, index, vertical: style?.vertical || Math.abs(Math.sin(angle)) > .01 }];
        });
        // 版本适配：BBoxReader 的坐标是首次记录 viewport 的归一化坐标。
        let vp = recordedViewport.get(pageNumber);
        if (!pdfPage.recordedBBoxes || !vp) {
          vp = pdfPage.getViewport({ scale: Math.min(1, 2048 / Math.max(...[pdfPage.view[2]! - pdfPage.view[0]!, pdfPage.view[3]! - pdfPage.view[1]!])) });
          const canvas = document.createElement("canvas"); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const task = pdfPage.render({ canvas, viewport: vp, recordOperations: true, recordImages: true, annotationMode: core.AnnotationMode.ENABLE }); renderTasks.add(task);
          try { await task.promise; } finally { renderTasks.delete(task); canvas.width = canvas.height = 0; }
          recordedViewport.set(pageNumber, vp);
        }
        if (current !== epoch) throw new Error("PDF 文档已改变");
        const graphics: PdfGraphic[] = [], ops = await pdfPage.getOperatorList();
        const rasterOps = new Set([core.OPS.paintImageXObject, core.OPS.paintInlineImageXObject, core.OPS.paintImageMaskXObject, core.OPS.paintImageXObjectRepeat, core.OPS.paintImageMaskXObjectRepeat, core.OPS.paintSolidColorImageMask]);
        const drawingOps = new Set([core.OPS.stroke, core.OPS.closeStroke, core.OPS.fill, core.OPS.eoFill, core.OPS.fillStroke, core.OPS.eoFillStroke, core.OPS.closeFillStroke, core.OPS.closeEOFillStroke, core.OPS.shadingFill, core.OPS.constructPath, ...rasterOps]);
        const normalizedRect = (r: number[]): PdfRect => {
          const corners = [[r[0]! * vp!.width, r[1]! * vp!.height], [r[2]! * vp!.width, r[3]! * vp!.height]].map(p => vp!.convertToPdfPoint(p[0]!, p[1]!));
          return [Math.min(corners[0]![0]!, corners[1]![0]!), Math.min(corners[0]![1]!, corners[1]![1]!), Math.max(corners[0]![0]!, corners[1]![0]!), Math.max(corners[0]![1]!, corners[1]![1]!)];
        };
        const boxes = pdfPage.recordedBBoxes;
        if (boxes) for (let i = 0; i < Math.min(boxes.length, ops.fnArray.length); i++) {
          const operation = ops.fnArray[i]!;
          const pathOperation = operation === core.OPS.constructPath ? ops.argsArray[i]?.[0] as unknown : operation;
          if (typeof pathOperation === "number" && drawingOps.has(pathOperation) && pathOperation !== core.OPS.constructPath && !boxes.isEmpty(i)) graphics.push({ bbox: normalizedRect([boxes.minX(i), boxes.minY(i), boxes.maxX(i), boxes.maxY(i)]), raster: rasterOps.has(operation) });
        }
        const values = pdfPage.imageCoordinates as ArrayLike<number> | null;
        if (values) for (let i = 0; i + 5 < values.length; i += 6) {
          const xs = [values[i]!, values[i + 2]!, values[i + 4]!, values[i + 2]! + values[i + 4]! - values[i]!], ys = [values[i + 1]!, values[i + 3]!, values[i + 5]!, values[i + 3]! + values[i + 5]! - values[i + 1]!];
          graphics.push({ bbox: normalizedRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]), raster: true });
        }
        return { items, blocks: buildPdfSelectionBlocks({ viewBox: pdfPage.view as PdfRect, textItems: items, graphics }) };
      })();
      analysis.set(pageNumber, pending); pending.catch(() => { if (analysis.get(pageNumber) === pending) analysis.delete(pageNumber); }); return pending;
    };
    const capture = async (pdfPage: PDFPageProxy, rect: PdfRect): Promise<PromptContextImage> => {
      const base = pdfPage.getViewport({ scale: 1, rotation: viewer.pagesRotation + pdfPage.rotate }), baseRect = pdfRectToViewport(rect, base);
      const width = baseRect[2] - baseRect[0], height = baseRect[3] - baseRect[1];
      const scale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(4194304 / (width * height)));
      const vp = pdfPage.getViewport({ scale, rotation: viewer.pagesRotation + pdfPage.rotate }), r = pdfRectToViewport(rect, vp);
      const x = Math.min(r[0]!, r[2]!), y = Math.min(r[1]!, r[3]!);
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.floor(Math.abs(r[2]! - r[0]!))); canvas.height = Math.max(1, Math.floor(Math.abs(r[3]! - r[1]!)));
      const task = pdfPage.render({ canvas, viewport: vp, transform: [1, 0, 0, 1, -x, -y], annotationMode: core.AnnotationMode.ENABLE }); renderTasks.add(task);
      try { await task.promise; const image: PromptContextImage = { mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1]!, width: canvas.width, height: canvas.height }; validatePromptContextImage(image); return image; }
      catch (error) { throw new Error(`选区截图失败，请缩小区域后重选：${error instanceof Error ? error.message : String(error)}`); }
      finally { renderTasks.delete(task); canvas.width = canvas.height = 0; }
    };
    const select = async (pageNumber: number, pageRect: PdfRect, selection: "paragraph" | "figure" | "region" | "text", text: string) => {
      const request = pick, current = epoch; if (!request || !doc || !visible) return;
      try {
        let image: PromptContextImage | undefined;
        if (selection === "figure" || selection === "region") {
          const pdfPage = await doc.getPage(pageNumber);
          if (pick !== request || current !== epoch || !visible) return;
          image = await capture(pdfPage, pageRect);
        }
        if (pick !== request || current !== epoch || !visible) return;
        const rect = projection({ anchorId: request.anchorId, page: pageNumber, pageRect }); if (!rect) throw new Error("选区已离开可见页面，请重新选择");
        if (text.length > 65536) throw new Error("所选文本超过 64Ki 限制，请缩小选区");
        selected = { anchorId: request.anchorId, page: pageNumber, pageRect };
        window.clearTimeout(pickTimeout); pickTimeout = undefined;
        pick = null; drag = null; host.classList.remove("picking"); layer.querySelectorAll(".pdf-candidate,.pdf-drag").forEach(n => n.remove());
        emit({ type: "selection", documentId, requestId: request.requestId, anchorId: request.anchorId, page: pageNumber, pageRect, selection, text, image, rect }); scheduleGeometry(); setStatus("");
      } catch (error) { if (pick === request) { report(error); cancelPick(); } }
    };
    const textPick = () => {
      const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) { setStatus("请先选择同一页内的文字"); cancelPick(); return; }
      const range = selection.getRangeAt(0), first = pageAt(range.startContainer.parentElement), last = pageAt(range.endContainer.parentElement);
      if (!first || first !== last) { setStatus("请在同一页选择评论内容"); cancelPick(); return; }
      const rect = range.getBoundingClientRect(), pageNumber = Number(first.dataset.pageNumber);
      if (!selection.toString().trim() || !rect.width || !rect.height) { cancelPick(); return; }
      void select(pageNumber, regionPdfRect(pageNumber, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }), "text", selection.toString());
    };
    const hover = async (event: PointerEvent) => {
      if (!pick || !visible) return;
      if (drag) {
        event.preventDefault();
        const x = Math.max(drag.bounds.left, Math.min(drag.bounds.right, event.clientX)), y = Math.max(drag.bounds.top, Math.min(drag.bounds.bottom, event.clientY));
        drag.current = { x: Math.min(drag.startX, x), y: Math.min(drag.startY, y), width: Math.abs(drag.startX - x), height: Math.abs(drag.startY - y) };
        layer.querySelectorAll(".pdf-drag").forEach(n => n.remove()); paintBox("pdf-drag", drag.current); return;
      }
      if (pick.mode !== "element") return;
      const sequence = ++hoverSequence, element = pageAt(event.target), request = pick; layer.querySelectorAll(".pdf-candidate").forEach(n => n.remove()); if (!element) return;
      try {
        const n = Number(element.dataset.pageNumber), data = await getAnalysis(n); if (request !== pick || sequence !== hoverSequence) return;
        const pv = viewer.getPageView(n - 1)!, box = pageContentRect(element), point = pv.viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top), block = choosePdfBlock(data.blocks, point[0]!, point[1]!);
        if (block) { const rect = projection({ anchorId: "", page: n, pageRect: block.pageRect }); if (rect) paintBox("pdf-candidate", rect, block.kind === "figure" ? "图块" : "段落"); }
      } catch (error) { report(error); }
    };
    const down = (event: PointerEvent) => {
      if (!pick) { suppressClick = false; return; }
      if (!pick || !event.isTrusted || event.button !== 0 || !visible) return;
      const element = pageAt(event.target); if (!element) return;
      event.preventDefault(); event.stopImmediatePropagation();
      suppressClick = true;
      if (pick.mode === "region") {
        const box = pageContentRect(element), viewport = host.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
        const bounds = new DOMRect(Math.max(box.left, viewport.left), Math.max(box.top, viewport.top), Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left), Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top));
        drag = { pointer: event.pointerId, page: Number(element.dataset.pageNumber), startX: event.clientX, startY: event.clientY, bounds, current: { x: event.clientX, y: event.clientY, width: 0, height: 0 } }; host.setPointerCapture(event.pointerId);
      }
    };
    const up = async (event: PointerEvent) => {
      if (!pick || !event.isTrusted || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (pick.mode === "region") {
        const current = drag; drag = null; if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
        layer.querySelectorAll(".pdf-drag").forEach(n => n.remove()); if (!current || current.current.width < 4 || current.current.height < 4) { cancelPick(); return; }
        const request = pick, documentEpoch = epoch;
        try {
          const r = regionPdfRect(current.page, current.current), data = await getAnalysis(current.page);
          if (pick !== request || epoch !== documentEpoch || !visible) return;
          const text = data.items.filter(t => { const x = (t.bbox[0] + t.bbox[2]) / 2, y = (t.bbox[1] + t.bbox[3]) / 2; return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }).sort((a,b) => a.index-b.index).map(t => t.str + (t.hasEOL ? "\n" : " ")).join("").trim();
          void select(current.page, r, "region", text);
        } catch (error) { if (pick === request) { report(error); cancelPick(); } }
        return;
      }
      const element = pageAt(event.target), request = pick; if (!element) return;
      try { const n = Number(element.dataset.pageNumber), data = await getAnalysis(n); if (request !== pick) return; const box = pageContentRect(element), pv = viewer.getPageView(n - 1)!, point = pv.viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top), block = choosePdfBlock(data.blocks, point[0]!, point[1]!); if (block) void select(n, block.pageRect, block.kind, block.text); }
      catch (error) { if (pick === request) { report(error); cancelPick(); } }
    };
    const click = (event: MouseEvent) => {
      if (pick || suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || !event.isTrusted) return;
      const href = anchor.getAttribute("href") ?? "";
      if (anchor.classList.contains("internalLink") || href.startsWith("#")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { const url = new URL(href); if (url.protocol === "http:" || url.protocol === "https:") emit({ type: "link", documentId, url: url.href }); } catch { /* 非网页动作不执行。 */ }
    };
    const invalidateDrag = () => { if (drag) cancelPick(); scheduleGeometry(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") cancelPick(); };
    const contextmenu = () => { if (pick) cancelPick(); };
    // 工具栏到原生 reader 的焦点交接可能带来迟到 blur；只取消真正失焦的选取。
    const blur = () => { if (!document.hasFocus()) cancelPick(); };
    const thumbnail = async (n: number, element: HTMLButtonElement) => {
      if (!doc || !thumbnailOpen || !visible || stopped || thumbnailDone.has(n)) return;
      thumbnailDone.add(n); const current = epoch;
      try {
        const p = await doc.getPage(n);
        if (epoch !== current || !visible || !thumbnailOpen || stopped) { thumbnailDone.delete(n); return; }
        const v = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: 128 / v.width }), canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const task = p.render({ canvas, viewport: vp, annotationMode: core.AnnotationMode.ENABLE }); renderTasks.add(task);
        try { await task.promise; } finally { renderTasks.delete(task); }
        if (epoch === current && thumbnailOpen && element.isConnected) element.prepend(canvas);
        else canvas.width = canvas.height = 0;
      }
      catch { thumbnailDone.delete(n); }
    };
    const setupThumbnails = () => {
      thumbnailObserver?.disconnect(); thumbnailHost.replaceChildren(); thumbnailDone.clear(); if (!doc || !thumbnailOpen) return;
      thumbnailObserver = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) void thumbnail(Number((entry.target as HTMLElement).dataset.page), entry.target as HTMLButtonElement); }, { root: thumbnailHost, rootMargin: "128px" });
      for (let n = 1; n <= doc.numPages; n++) { const button = document.createElement("button"); button.dataset.page = `${n}`; button.textContent = `${n}`; button.onclick = () => { viewer.currentPageNumber = n; }; thumbnailHost.append(button); thumbnailObserver.observe(button); }
    };
    controls.current = {
      page(n) { if (doc) viewer.currentPageNumber = Math.max(1, Math.min(doc.numPages, n)); },
      zoom(factor) { cancelPick(); stopped = false; viewer.currentScale = Math.max(.1, Math.min(10, viewer.currentScale * factor)); },
      fit() { cancelPick(); stopped = false; viewer.currentScaleValue = "page-width"; },
      rotate() { cancelPick(); stopped = false; viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; },
      find(value, previous = false) { bus.dispatch("find", { source: window, type: "again", query: value, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false }); },
      thumbnails(open) { thumbnailOpen = open; thumbnailDone.clear(); setupThumbnails(); },
      password(value) { const callback = passwordCallback; passwordCallback = null; setSecret(""); setPassword(null); callback?.(value); },
      cancelPassword() { passwordCallback = null; setPassword(null); const cleanup = workerCleanup; workerCleanup = null; void loading?.destroy().finally(() => cleanup?.()); emit({ type: "error", documentId, message: "已取消 PDF 密码输入" }); },
    };
    const finishInitialView = (): boolean => {
      if (!initialView || !visible || host.clientWidth <= 0 || host.clientHeight <= 0 || !viewer.pagesCount) return false;
      const hash = pendingHash ?? initialView.hash;
      initialView = null;
      // 首次适宽必须等待真实可见布局；零宽隐藏 view 会把页面缩放到零。
      viewer.currentScaleValue = "page-width";
      if (hash) linkService.setHash(hash);
      else viewer.scrollPageIntoView({ pageNumber: 1 });
      return true;
    };
    const load = async (id: string) => {
      const current = ++epoch; cancelPick(); revealEpoch++; cancelRenders(); analysis.clear(); recordedViewport.clear(); markers = []; selected = null; thumbnailDone.clear(); thumbnailObserver?.disconnect(); thumbnailHost.replaceChildren();
      documentId = id; pendingHash = null;
      initialView = null;
      viewer.setDocument(null); linkService.setDocument(null); doc = null;
      const previous = loading, previousWorkerCleanup = workerCleanup; loading = null; workerCleanup = null;
      if (previous) await previous.destroy(); previousWorkerCleanup?.();
      if (current !== epoch) return;
      documentId = id; ready = false; stopped = false; setStatus("正在加载 PDF…"); setPassword(null); setTotal(0);
      try {
        const result = await window.pdfViewer.getDocument(id); if (current !== epoch) return;
        // 显式本地 Worker 避免 file: origin 被 PDF.js 包装为 CSP 禁止的 blob:。
        const port = new Worker(workerUrl, { type: "module" }), worker = core.PDFWorker.create({ port });
        workerCleanup = () => { worker.destroy(); port.terminate(); };
        const task = core.getDocument({ data: result.bytes, worker, enableXfa: false, docBaseUrl: result.url, cMapUrl: asset("cmaps"), cMapPacked: true, standardFontDataUrl: asset("standard_fonts"), wasmUrl: asset("wasm") }); loading = task;
        port.onerror = event => {
          if (current !== epoch) return;
          const message = event.message || "PDF worker 加载失败";
          report(message); emit({ type: "error", documentId: id, message });
          void task.destroy().finally(() => { worker.destroy(); port.terminate(); });
        };
        task.onPassword = (callback: (value: string) => void, reason: number) => { if (current !== epoch) return; passwordCallback = callback; const incorrect = reason === core.PasswordResponses.INCORRECT_PASSWORD; setPassword(incorrect); setStatus(""); emit({ type: "password", documentId, incorrect }); };
        const pdf = await task.promise; if (current !== epoch) { await task.destroy(); return; }
        doc = pdf; setTotal(pdf.numPages); linkService.setDocument(pdf); viewer.setDocument(pdf); setStatus("");
        void Promise.resolve(viewer.pagesPromise).catch((error: unknown) => {
          if (current !== epoch) return;
          report(error);
          emit({ type: "error", documentId: id, message: error instanceof Error ? error.message : String(error) });
        });
        await viewer.firstPagePromise; if (current !== epoch) return;
        initialView = { hash: new URL(result.url).hash.slice(1) };
        finishInitialView();
        if (!visible) cancelRenders(); else viewer.update(); if (thumbnailOpen) setupThumbnails();
      } catch (error) { if (current !== epoch) return; report(error); emit({ type: "error", documentId: id, message: error instanceof Error ? error.message : String(error) }); }
    };
    const reveal = async (command: Extract<PdfViewerCommand, { type: "reveal" }>) => {
      const current = ++revealEpoch, documentEpoch = epoch; cancelPick(); stopped = false;
      try {
        if (!doc || !visible) throw new Error("PDF 不可见");
        const p = await doc.getPage(command.page), rect = clipPdfRect(command.pageRect, p.view as PdfRect); if (!rect) throw new Error("无效 PDF 锚点");
        viewer.scrollPageIntoView({ pageNumber: command.page, destArray: [null, { name: "XYZ" }, rect[0], rect[3], null], allowNegativeOffset: true });
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && current === revealEpoch && epoch === documentEpoch && visible) {
          viewer.update(); const pv = viewer.getPageView(command.page - 1), found = projection(command);
          if (found && pv?.textLayer?.div?.isConnected) { emit({ type: "revealed", documentId, requestId: command.requestId, anchorId: command.anchorId, rect: found }); scheduleGeometry(); return; }
          await new Promise<void>(resolve => setTimeout(resolve, 32));
        }
      } catch (error) { report(error); }
      if (current === revealEpoch && epoch === documentEpoch) emit({ type: "revealed", documentId, requestId: command.requestId, anchorId: command.anchorId });
    };
    const unsubscribe = window.pdfViewer.onCommand(command => {
      if (command.type === "load") { void load(command.documentId); return; }
      if (command.documentId !== documentId) return;
      switch (command.type) {
        case "hash": cancelPick(); pendingHash = command.hash.replace(/^#/, ""); if (doc && !initialView && viewer.pagesCount && visible) linkService.setHash(pendingHash); break;
        case "stop": stopped = true; cancelPick(); revealEpoch++; cancelRenders(); break;
        case "pick":
          cancelPick(); if (!doc || !visible || !ready) { emit({ type: "cancelled", documentId, requestId: command.requestId }); break; }
          pick = command; stopped = false;
          pickTimeout = window.setTimeout(() => { if (pick === command) cancelPick(); }, 60_000);
          if (command.mode === "text") textPick();
          else { host.classList.add("picking"); setStatus(command.mode === "region" ? "拖动框选可见区域，Esc 取消" : "点击段落、图片或流程图；识别不准可框选"); const n = viewer.currentPageNumber; for (const p of [n - 1, n, n + 1]) if (p >= 1 && p <= doc.numPages) void getAnalysis(p).catch(report); }
          break;
        case "cancel": if (pick?.requestId === command.requestId) cancelPick(); revealEpoch++; break;
        case "markers": revision = command.revision; markers = command.markers; scheduleGeometry(); break;
        case "reveal": void reveal(command); break;
        case "visibility": {
          const becameVisible = !visible && command.visible;
          document.documentElement.style.setProperty("--host-scale", String(command.fontScale));
          visible = command.visible;
          if (!visible) { cancelPick(); revealEpoch++; cancelRenders(); if (frame) cancelAnimationFrame(frame); frame = 0; layer.replaceChildren(); }
          else {
            stopped = false;
            const initialized = finishInitialView(), scale = viewer.currentScaleValue;
            if (!initialized && becameVisible && doc && host.clientWidth > 0 && host.clientHeight > 0 && ["auto", "page-width", "page-fit", "page-height"].includes(scale)) viewer.currentScaleValue = scale;
            viewer.update(); announceReady(); scheduleGeometry(); if (thumbnailOpen) setupThumbnails();
          }
          break;
        }
      }
    });
    bus.on("pagerender", ({ source, pageNumber }: { source: unknown; pageNumber: number }) => {
      const p = viewer.getPageView(pageNumber - 1);
      if (doc && p && p === source && !recordedViewport.has(pageNumber)) recordedViewport.set(pageNumber, p.viewport.clone());
    });
    bus.on("pagerendered", ({ source, pageNumber, error }: { source: unknown; pageNumber: number; error?: unknown }) => {
      if (!doc || viewer.getPageView(pageNumber - 1) !== source) return;
      if (error && !ready) { emit({ type: "error", documentId, message: String(error) }); return; }
      announceReady();
      scheduleGeometry();
    });
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => { setPage(pageNumber); scheduleGeometry(); });
    bus.on("scalechanging", () => { cancelPick(); scheduleGeometry(); }); bus.on("rotationchanging", () => { cancelPick(); scheduleGeometry(); });
    host.addEventListener("pointerdown", down, true); host.addEventListener("pointerup", up, true); host.addEventListener("pointermove", hover); host.addEventListener("click", click, true); host.addEventListener("contextmenu", contextmenu, true); host.addEventListener("scroll", invalidateDrag, { passive: true });
    window.addEventListener("keydown", keydown); window.addEventListener("blur", blur);
    const resize = new ResizeObserver(() => { invalidateDrag(); if (finishInitialView()) { viewer.update(); announceReady(); } });
    resize.observe(host);
    return () => {
      epoch++; revealEpoch++; unsubscribe(); controls.current = null; cancelPick(); cancelRenders();
      thumbnailObserver?.disconnect(); resize.disconnect(); if (frame) cancelAnimationFrame(frame);
      const cleanup = workerCleanup; workerCleanup = null;
      if (loading) void loading.destroy().finally(() => cleanup?.()); else cleanup?.();
      viewer.setDocument(null);
      host.removeEventListener("pointerdown", down, true); host.removeEventListener("pointerup", up, true); host.removeEventListener("pointermove", hover); host.removeEventListener("click", click, true); host.removeEventListener("contextmenu", contextmenu, true); host.removeEventListener("scroll", invalidateDrag);
      window.removeEventListener("keydown", keydown); window.removeEventListener("blur", blur);
    };
  }, [core, web]);
  return <main className="pdf-reader">
    <nav className="pdf-toolbar" aria-label="PDF 阅读工具">
      <button title="缩略图" aria-pressed={thumbnails} onClick={() => { setThumbnails(!thumbnails); controls.current?.thumbnails(!thumbnails); }}>▤</button>
      <button title="上一页" disabled={page <= 1} onClick={() => controls.current?.page(page - 1)}>‹</button>
      <input aria-label="页码" type="number" min={1} max={total || 1} value={page} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value > 0) controls.current?.page(value); }}/><span>/ {total}</span>
      <button title="下一页" disabled={page >= total} onClick={() => controls.current?.page(page + 1)}>›</button>
      <button title="缩小" onClick={() => controls.current?.zoom(1 / 1.2)}>−</button><button title="放大" onClick={() => controls.current?.zoom(1.2)}>＋</button>
      <button title="适合宽度" onClick={() => controls.current?.fit()}>↔</button><button title="旋转90度" onClick={() => controls.current?.rotate()}>↻</button>
      <input className="pdf-find" aria-label="查找 PDF 文本" placeholder="查找" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") controls.current?.find(query, e.shiftKey); }}/><button title="查找下一个" onClick={() => controls.current?.find(query)}>⌕</button>
    </nav>
    <section className={thumbnails ? "pdf-body with-thumbnails" : "pdf-body"}><aside ref={thumbs} aria-label="页面缩略图" hidden={!thumbnails}/><div ref={container} className="pdf-container"><div ref={pages} className="pdfViewer"/></div></section>
    <div ref={overlay} className="pdf-overlays"/>{status && <output className="pdf-status">{status}</output>}
    {password !== null && <div className="pdf-password"><form onSubmit={event => { event.preventDefault(); controls.current?.password(secret); }}><h2>PDF 需要密码</h2>{password && <p role="alert">密码不正确，请重试</p>}<input autoFocus type="password" aria-label="PDF 密码" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="off"/><button type="submit">打开</button><button type="button" onClick={() => { setSecret(""); controls.current?.cancelPassword(); }}>取消</button></form></div>}
  </main>;
}
