import React from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import "./pdf-viewer.css";
import { PdfViewer } from "./PdfViewer";
// web/pdf_viewer 读取这个全局；必须先安装 core，再动态载入 web 层。
Object.assign(globalThis, { pdfjsLib: pdfjs });
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
void import("pdfjs-dist/web/pdf_viewer.mjs").then(web => {
  createRoot(document.getElementById("root")!).render(<PdfViewer core={pdfjs} web={web} />);
}).catch(error => { document.getElementById("root")!.textContent = `PDF 阅读器加载失败：${String(error)}`; });
