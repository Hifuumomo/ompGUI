import type { BrowserSelectionMode } from "./browser";
import type { PdfSelectionKind, PromptContextImage } from "./prompt-context";

export type PdfPickMode = BrowserSelectionMode | "text";
export type PdfPageRect = [number, number, number, number];
export interface PdfViewportRect { x: number; y: number; width: number; height: number }
export interface PdfPickRequest { documentId: string; requestId: string; anchorId: string; mode: PdfPickMode }
export interface PdfMarker { anchorId: string; number: number; page: number; pageRect: PdfPageRect }
export interface PdfSelectionResult {
  requestId: string; anchorId: string; page: number; pageRect: PdfPageRect;
  selection: PdfSelectionKind; text: string; image?: PromptContextImage; rect: PdfViewportRect;
}
export type PdfViewerCommand =
  | { type: "load"; documentId: string }
  | ({ type: "pick" } & PdfPickRequest)
  | { type: "cancel"; documentId: string; requestId: string }
  | { type: "hash"; documentId: string; hash: string }
  | { type: "stop"; documentId: string }
  | { type: "markers"; documentId: string; revision: number; markers: PdfMarker[] }
  | { type: "reveal"; documentId: string; requestId: string; anchorId: string; page: number; pageRect: PdfPageRect }
  | { type: "visibility"; documentId: string; visible: boolean; fontScale: number };
export type PdfViewerEvent =
  | { type: "ready"; documentId: string; pages: number }
  | { type: "password"; documentId: string; incorrect: boolean }
  | { type: "error"; documentId: string; message: string }
  | ({ type: "selection"; documentId: string } & PdfSelectionResult)
  | { type: "cancelled"; documentId: string; requestId: string }
  | { type: "geometry"; documentId: string; revision: number; anchors: Array<{ anchorId: string; rect?: PdfViewportRect }> }
  | { type: "revealed"; documentId: string; requestId: string; anchorId: string; rect?: PdfViewportRect }
  | { type: "marker"; documentId: string; revision: number; anchorId: string }
  | { type: "link"; documentId: string; url: string };
export const pdfViewerChannels = {
  document: "pdf-viewer:document", command: "pdf-viewer:command", event: "pdf-viewer:event",
} as const;
export interface PdfViewerBridge {
  getDocument(documentId: string): Promise<{ bytes: Uint8Array; url: string; title: string }>;
  onCommand(listener: (command: PdfViewerCommand) => void): () => void;
  send(event: PdfViewerEvent): void;
}
