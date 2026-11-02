// @vitest-environment node
import { EventEmitter } from "node:events";
import type { IpcMainEvent, WebContents } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PERF_RENDERER_CHANNEL, isRendererPerformanceSample } from "../shared/performance";

const electron = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: electron }));
import { registerPerformanceIPC } from "./performance-ipc";

const sample = { durationMs: 2_000, longTaskCount: 2, longTaskTotalMs: 150, longTaskMaxMs: 90 };
let dispose: (() => void) | undefined;
let now = 0;
beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks(); });

function sender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as WebContents;
}
function receiver() {
  return electron.on.mock.calls[0][1] as (event: IpcMainEvent, value: unknown) => void;
}
function event(contents: WebContents) { return { sender: contents } as IpcMainEvent; }

it("accepts exact finite consistent aggregates and rejects malformed statistics", () => {
  expect(isRendererPerformanceSample(sample)).toBe(true);
  expect(isRendererPerformanceSample({ ...sample, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0 })).toBe(true);
  const invalid = [
    null, [], {}, { ...sample, prompt: "secret" },
    { ...sample, durationMs: NaN }, { ...sample, durationMs: Infinity },
    { ...sample, durationMs: 0 }, { ...sample, durationMs: 3_600_001 },
    { ...sample, longTaskCount: 1.5 }, { ...sample, longTaskCount: -1 },
    { ...sample, longTaskCount: 100_001 }, { ...sample, longTaskCount: 0 },
    { ...sample, longTaskCount: 1 }, { ...sample, longTaskTotalMs: 80 },
    { ...sample, longTaskMaxMs: 49 }, { ...sample, longTaskTotalMs: 100 },
    { ...sample, longTaskTotalMs: 181 }, { ...sample, longTaskTotalMs: 3_600_001 },
    { ...sample, longTaskMaxMs: "90" },
  ];
  for (const value of invalid) expect(isRendererPerformanceSample(value)).toBe(false);
});

it("checks authorization and schema before reporting; diagnostics never throw", () => {
  const trusted = sender();
  const report = vi.fn();
  dispose = registerPerformanceIPC((incoming) => { if (incoming.sender !== trusted) throw new Error("untrusted"); }, report);
  expect(() => receiver()(event(sender()), sample)).not.toThrow();
  receiver()(event(trusted), { ...sample, text: "private" });
  expect(report).not.toHaveBeenCalled();
  receiver()(event(trusted), sample);
  expect(report).toHaveBeenCalledExactlyOnceWith(sample);
});

it("limits each sender independently and removes destruction and channel listeners", () => {
  const report = vi.fn();
  dispose = registerPerformanceIPC(() => {}, report);
  const first = sender();
  const second = sender();
  receiver()(event(first), sample);
  now = 999;
  receiver()(event(first), sample);
  receiver()(event(second), sample);
  expect(report).toHaveBeenCalledTimes(2);
  now = 1_000;
  receiver()(event(first), sample);
  expect(report).toHaveBeenCalledTimes(3);
  expect(first.listenerCount("destroyed")).toBe(1);
  first.emit("destroyed");
  expect(first.listenerCount("destroyed")).toBe(0);
  dispose();
  expect(second.listenerCount("destroyed")).toBe(0);
  expect(electron.removeListener).toHaveBeenCalledWith(PERF_RENDERER_CHANNEL, receiver());
});

it("bounds sender tracking and releases capacity on destruction", () => {
  const report = vi.fn();
  dispose = registerPerformanceIPC(() => {}, report);
  const contents = Array.from({ length: 17 }, sender);
  for (const item of contents) receiver()(event(item), sample);
  expect(report).toHaveBeenCalledTimes(16);
  expect(contents[16].listenerCount("destroyed")).toBe(0);
  contents[0].emit("destroyed");
  receiver()(event(contents[16]), sample);
  expect(report).toHaveBeenCalledTimes(17);
});

it("ignores destroyed senders and catches reporting errors", () => {
  const report = vi.fn(() => { throw new Error("diagnostic failure"); });
  dispose = registerPerformanceIPC(() => {}, report);
  const dead = sender();
  dead.isDestroyed = () => true;
  receiver()(event(dead), sample);
  expect(report).not.toHaveBeenCalled();
  expect(() => receiver()(event(sender()), sample)).not.toThrow();
});
