// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startRendererPerformance } from "./performance";

let now = 0;
let deliver: (list: PerformanceObserverEntryList) => void;
let records: PerformanceEntry[] = [];
const observe = vi.fn();
const disconnect = vi.fn();
let stop: (() => void) | undefined;

class Observer {
  static supportedEntryTypes = ["longtask"];
  constructor(callback: (list: PerformanceObserverEntryList) => void) { deliver = callback; }
  observe = observe;
  disconnect = disconnect;
  takeRecords() { const queued = records; records = []; return queued; }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  now = 0;
  records = [];
  Observer.supportedEntryTypes = ["longtask"];
  observe.mockReset();
  vi.stubGlobal("PerformanceObserver", Observer);
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function entry(duration: number, entryType = "longtask") {
  return { duration, entryType, name: "private URL must not be copied" } as PerformanceEntry;
}
function emit(...entries: PerformanceEntry[]) {
  deliver({ getEntries: () => entries } as PerformanceObserverEntryList);
}
function interval() {
  now += 2_000;
  vi.advanceTimersByTime(2_000);
}

it("aggregates callbacks and pending records once per two seconds and resets counters", () => {
  const report = vi.fn();
  stop = startRendererPerformance({ report });
  expect(observe).toHaveBeenCalledWith({ type: "longtask" });
  emit(entry(60), entry(90), entry(NaN), entry(10), entry(500, "resource"));
  records.push(entry(70));
  expect(report).not.toHaveBeenCalled();
  interval();
  expect(report).toHaveBeenLastCalledWith({ durationMs: 2_000, longTaskCount: 3, longTaskTotalMs: 220, longTaskMaxMs: 90 });
  interval();
  expect(report).toHaveBeenLastCalledWith({ durationMs: 2_000, longTaskCount: 0, longTaskTotalMs: 0, longTaskMaxMs: 0 });
});

it("does not install timers or lifecycle hooks when longtask is unsupported", () => {
  Observer.supportedEntryTypes = ["resource"];
  const add = vi.spyOn(window, "addEventListener");
  const report = vi.fn();
  stop = startRendererPerformance({ report });
  expect(observe).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(add).not.toHaveBeenCalled();
  interval();
  expect(report).not.toHaveBeenCalled();
});

it("handles absent or rejected observer support without timers", () => {
  vi.stubGlobal("PerformanceObserver", undefined);
  stop = startRendererPerformance({ report: vi.fn() });
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("PerformanceObserver", Observer);
  observe.mockImplementation(() => { throw new Error("unsupported"); });
  stop = startRendererPerformance({ report: vi.fn() });
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("pagehide disconnects and clears the interval; HMR disposer is idempotent", () => {
  const report = vi.fn();
  stop = startRendererPerformance({ report });
  emit(entry(60));
  window.dispatchEvent(new Event("pagehide"));
  stop();
  emit(entry(90));
  interval();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(report).not.toHaveBeenCalled();
});

it("explicit disposal removes pagehide hooks and permits a fresh monitor", () => {
  const remove = vi.spyOn(window, "removeEventListener");
  stop = startRendererPerformance({ report: vi.fn() });
  const firstStop = stop;
  stop();
  expect(remove).toHaveBeenCalledWith("pagehide", firstStop);
  stop = startRendererPerformance({ report: vi.fn() });
  expect(vi.getTimerCount()).toBe(1);
  window.dispatchEvent(new Event("pagehide"));
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("drops overflowed intervals rather than reporting truncated numbers", () => {
  const report = vi.fn();
  stop = startRendererPerformance({ report });
  emit(entry(3_600_001));
  interval();
  expect(report).not.toHaveBeenCalled();
  emit(entry(50));
  interval();
  expect(report).toHaveBeenCalledWith({ durationMs: 2_000, longTaskCount: 1, longTaskTotalMs: 50, longTaskMaxMs: 50 });
});

it("a reporting failure does not stop later intervals", () => {
  const report = vi.fn(() => { throw new Error("bridge closed"); });
  stop = startRendererPerformance({ report });
  expect(interval).not.toThrow();
  expect(interval).not.toThrow();
  expect(report).toHaveBeenCalledTimes(2);
});
