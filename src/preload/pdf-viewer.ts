import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { PdfViewerBridge, PdfViewerCommand } from "../shared/pdf-viewer";
// 独立 sandbox preload 只使用 Electron；运行时不引入共享 require chunk。
const channels = { document: "pdf-viewer:document", command: "pdf-viewer:command", event: "pdf-viewer:event" };
let latestLoad: PdfViewerCommand | undefined;
let latestVisibility: PdfViewerCommand | undefined;
let latestHash: PdfViewerCommand | undefined;
const listeners = new Set<(command: PdfViewerCommand) => void>();
ipcRenderer.on(channels.command, (_event: IpcRendererEvent, command: PdfViewerCommand) => {
  if (command.type === "load") { latestLoad = command; latestHash = undefined; latestVisibility = undefined; }
  if (command.type === "visibility") latestVisibility = command;
  if (command.type === "hash") latestHash = command;
  for (const listener of listeners) listener(command);
});
const bridge: PdfViewerBridge = {
  getDocument: (documentId) => ipcRenderer.invoke(channels.document, documentId),
  onCommand(listener) {
    listeners.add(listener);
    if (latestLoad) listener(latestLoad);
    if (latestVisibility) listener(latestVisibility);
    if (latestHash) listener(latestHash);
    return () => { listeners.delete(listener); };
  },
  send: (event) => ipcRenderer.send(channels.event, event),
};
contextBridge.exposeInMainWorld("pdfViewer", bridge);
