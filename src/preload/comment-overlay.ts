import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { commentOverlayChannels, type CommentOverlayBridge, type CommentOverlayState } from "../shared/comment-overlay";

let latest: CommentOverlayState | null | undefined;
const listeners = new Set<(state: CommentOverlayState | null) => void>();
ipcRenderer.on(commentOverlayChannels.state, (_event: IpcRendererEvent, state: CommentOverlayState | null) => {
  latest = state;
  for (const listener of listeners) listener(state);
});

const bridge: CommentOverlayBridge = {
  onState(listener) {
    listeners.add(listener);
    if (latest !== undefined) listener(latest);
    return () => { listeners.delete(listener); };
  },
  ready(requestId) {
    ipcRenderer.send(commentOverlayChannels.ready, requestId);
  },
  send(requestId, event) {
    ipcRenderer.send(commentOverlayChannels.event, { requestId, event });
  },
};
contextBridge.exposeInMainWorld("commentOverlay", bridge);
