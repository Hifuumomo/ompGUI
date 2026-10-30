export type BrowserSelectionMode = "element" | "region";

export interface BrowserPanelState {
  revision: number;
  url: string;
  title: string;
  loading: boolean;
  selectingElement: boolean;
  selectionMode?: BrowserSelectionMode;
  /** 仅由当前主页面内置 PDF viewer 身份确定。 */
  isPDF?: boolean;
  pdfStatus?: "loading" | "password" | "ready" | "error";
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
}

export interface BrowserPanelLayout {
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export type BrowserPanelAction = "back" | "forward" | "reload" | "stop" | "close";
