// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PERF_RENDERER_ARGUMENT, PERF_RENDERER_CHANNEL, type RendererPerformanceBridge } from "../shared/performance";

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), send: vi.fn() }));
// 测试模块加载边界：必须先切换 argv 再执行 preload，静态导入无法覆盖开关两态。
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { send: electron.send },
  webFrame: {},
}));
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = originalArgv.filter((argument) => argument !== PERF_RENDERER_ARGUMENT);
});
afterEach(() => { process.argv = originalArgv; });

it("normal preload exposes only the original desktop bridge and sends nothing", async () => {
  await import("./index");
  expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(1);
  expect(electron.exposeInMainWorld.mock.calls[0][0]).toBe("desktop");
  expect(electron.send).not.toHaveBeenCalled();
});

it("the explicit argument exposes a separate fixed-channel numeric-only bridge", async () => {
  process.argv.push(PERF_RENDERER_ARGUMENT);
  await import("./index");
  expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(2);
  const bridge = electron.exposeInMainWorld.mock.calls.find(([name]) => name === "desktopPerformance")![1] as RendererPerformanceBridge;
  const sample = { durationMs: 2_000, longTaskCount: 1, longTaskTotalMs: 60, longTaskMaxMs: 60 };
  bridge.report(sample);
  expect(electron.send).toHaveBeenCalledWith(PERF_RENDERER_CHANNEL, sample);
  bridge.report({ ...sample, prompt: "secret" } as typeof sample);
  bridge.report({ ...sample, longTaskMaxMs: Infinity });
  expect(electron.send).toHaveBeenCalledTimes(1);
});
