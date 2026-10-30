import type { BrowserCommentAnchor } from "./comment-anchor";
import type { PromptContextImage } from "./prompt-context";

export interface BrowserCommentEditor {
  scope: string;
  editorId: string;
  sourceAnchor: BrowserCommentAnchor;
  image?: PromptContextImage;
  source: string;
  comment: string;
  theme: "light" | "dark";
  fontSize: number;
  error?: string;
  editing?: boolean;
}

export interface BrowserCommentMarker {
  scope: string;
  id: string;
  number: number;
  sourceAnchor: BrowserCommentAnchor;
}

export interface BrowserCommentRevealRequest {
  scope: string;
  requestId: string;
  entryId: string;
  documentId: string;
  anchorId: string;
}

export type BrowserCommentRevealResult =
  | { requestId: string; status: "located" }
  | { requestId: string; status: "unavailable"; reason: string };

export type BrowserCommentEvent =
  | { type: "change" | "confirm"; scope: string; editorId: string; comment: string }
  | { type: "cancel"; scope: string; editorId: string }
  | { type: "marker"; scope: string; id: string };

// This module is the sandbox preload's only runtime dependency besides Electron.
export const commentOverlayChannels = {
  state: "comment-overlay:state",
  ready: "comment-overlay:ready",
  event: "comment-overlay:event",
} as const;

export interface CommentOverlayState {
  requestId: string;
  editor: BrowserCommentEditor;
  unavailable?: string;
}

export interface CommentOverlayBridge {
  onState(listener: (state: CommentOverlayState | null) => void): () => void;
  ready(requestId: string): void;
  send(requestId: string, event: BrowserCommentEvent): void;
}
