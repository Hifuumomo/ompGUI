import { ipcMain, type IpcMainEvent, type WebContents } from "electron";
import { isRendererPerformanceSample, PERF_RENDERER_CHANNEL, type RendererPerformanceSample } from "../shared/performance";

const MIN_SAMPLE_INTERVAL_MS = 1_000;
const MAX_SENDERS = 16;

/** 显式启用的窄通道；拒绝未授权、畸形及过频采样，退出时移除全部监听。 */
export function registerPerformanceIPC(
  assertSender: (event: IpcMainEvent) => void,
  report: (sample: RendererPerformanceSample) => void,
): () => void {
  const senders = new Map<WebContents, { lastAt: number; cleanup: () => void }>();
  const receive = (event: IpcMainEvent, value: unknown) => {
    try {
      assertSender(event);
      if (event.sender.isDestroyed() || !isRendererPerformanceSample(value)) return;
      const now = performance.now();
      const previous = senders.get(event.sender);
      if (previous && now - previous.lastAt < MIN_SAMPLE_INTERVAL_MS) return;
      if (!previous) {
        if (senders.size >= MAX_SENDERS) return;
        const sender = event.sender;
        const cleanup = () => { senders.delete(sender); };
        senders.set(sender, { lastAt: now, cleanup });
        sender.once("destroyed", cleanup);
      } else {
        previous.lastAt = now;
      }
      // 重新构造固定字段，主进程日志不接收渲染器附带的任何内容。
      report({
        durationMs: value.durationMs,
        longTaskCount: value.longTaskCount,
        longTaskTotalMs: value.longTaskTotalMs,
        longTaskMaxMs: value.longTaskMaxMs,
      });
    } catch {
      // 不可信发送方与诊断失败均不得逃逸到应用 IPC 事件循环。
    }
  };
  ipcMain.on(PERF_RENDERER_CHANNEL, receive);
  return () => {
    ipcMain.removeListener(PERF_RENDERER_CHANNEL, receive);
    for (const [sender, state] of senders) sender.removeListener("destroyed", state.cleanup);
    senders.clear();
  };
}
