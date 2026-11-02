// @vitest-environment node
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createPerformanceLogger,
  getPerformanceLogger,
  startPerformanceLogging,
  type PerformanceLogger,
  type PerformanceLogConfiguration,
} from "./performance-log";

type LogRecord = {
  schemaVersion: number;
  runId: string;
  elapsedMs: number;
  event: string;
  fields: Record<string, string | number | boolean>;
};
let directory: string;
const loggers: PerformanceLogger[] = [];
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), "ompgui-perf-test-")); });
afterEach(async () => {
  await Promise.all(loggers.splice(0).map((logger) => logger.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  await fs.rm(directory, { recursive: true, force: true });
});

async function start(configuration: PerformanceLogConfiguration = {}, onStopped = () => {}) {
  const logger = await createPerformanceLogger(
    { directory, getAppMetrics: () => [] },
    { announce: () => {}, warn: () => {}, ...configuration },
    onStopped,
  );
  expect(logger).toBeDefined();
  loggers.push(logger!);
  return logger!;
}

async function readRecords(): Promise<LogRecord[]> {
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".jsonl")).sort();
  const contents = await Promise.all(names.map((name) => fs.readFile(join(directory, name), "utf8")));
  return contents.flatMap((content) => content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogRecord));
}

it("导入与未启动的 getter 不创建文件或计时器", async () => {
  const mkdir = vi.spyOn(fs, "mkdir");
  const timer = vi.spyOn(globalThis, "setInterval");
  vi.resetModules();
  // 本测试专门检验模块加载边界，静态导入无法观测导入时的副作用。
  const fresh = await import("./performance-log");
  expect(fresh.getPerformanceLogger()).toBeUndefined();
  expect(getPerformanceLogger()).toBeUndefined();
  expect(mkdir).not.toHaveBeenCalled();
  expect(timer).not.toHaveBeenCalled();
});

it("关闭前保留最后一批 count/observe，使用真实 count/total/max 并拒绝私密文本", async () => {
  const logger = await start();
  logger.count("rpc.chunks", 3, { engineId: "engine-1" });
  logger.count("rpc.chunks", 2, { engineId: "engine-1" });
  logger.observe("rpc.duration", 12, { outcome: "success" });
  logger.observe("rpc.duration", 4, { outcome: "success" });
  logger.event("engine.start", { engineId: "engine-1" });
  logger.event("unsafe", { text: "secret prompt with spaces" });
  logger.event("unsafe", { file: "C:\\private\\session.json" });
  logger.observe("unsafe", Infinity);
  const close = logger.close();
  expect(logger.close()).toBe(close);
  await close;
  logger.event("after.close");
  const records = await readRecords();
  expect(records[0].event).toBe("run.header");
  expect(records.at(-1)?.event).toBe("run.summary");
  expect(records.find((record) => record.event === "metric.count")?.fields).toMatchObject({
    name: "rpc.chunks", count: 2, total: 5, max: 3, engineId: "engine-1",
  });
  expect(records.find((record) => record.event === "metric.observe")?.fields).toMatchObject({
    name: "rpc.duration", count: 2, total: 16, max: 12,
  });
  expect(records.at(-1)?.fields.droppedRecords).toBe(3);
  expect(records.some((record) => record.event === "after.close" || record.event === "unsafe")).toBe(false);
  expect(records.every((record) => record.schemaVersion === 1 && record.elapsedMs >= 0)).toBe(true);
  expect(new Set(records.map((record) => record.runId)).size).toBe(1);
});

it("缓冲区与聚合键有界，饱和时仍保留生命周期和丢弃总数", async () => {
  const logger = await start({ bufferBytes: 600, reserveBytes: 2048, aggregateKeys: 2 });
  for (let index = 0; index < 2000; index += 1) {
    logger.event("queue.progress", { index });
    logger.observe("rpc.duration", index, { engineId: `engine-${index}` });
  }
  logger.event("engine.exit", { code: 0 });
  await logger.close();
  const records = await readRecords();
  expect(records.length).toBeLessThan(12);
  expect(records.find((record) => record.event === "engine.exit")).toBeDefined();
  expect(records.at(-1)?.fields.droppedRecords).toBeGreaterThan(3900);
});

it("分卷字节上限严格执行，每个分卷都有头部", async () => {
  const logger = await start({ fileBytes: 1500, directoryBytes: 15_000 });
  for (let index = 0; index < 20; index += 1) logger.event("engine.exit", { index });
  await logger.close();
  const names = await fs.readdir(directory);
  expect(names.length).toBeGreaterThan(1);
  for (const name of names) {
    const path = join(directory, name);
    expect((await fs.stat(path)).size).toBeLessThanOrEqual(1500);
    const first = (await fs.readFile(path, "utf8")).split("\n")[0];
    expect(JSON.parse(first).event).toBe("run.header");
  }
  expect((await readRecords()).at(-1)?.event).toBe("run.summary");
});

it("长运行仅回收自身已关闭分卷，保留末尾汇总且目录不突破预算", async () => {
  const warn = vi.fn();
  const logger = await start({ fileBytes: 1500, directoryBytes: 4500, warn });
  for (let index = 0; index < 40; index += 1) logger.event("engine.exit", { index });
  await logger.close();
  const names = await fs.readdir(directory);
  const sizes = await Promise.all(names.map(async (name) => (await fs.stat(join(directory, name))).size));
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(4500);
  const records = await readRecords();
  expect(records[0].fields.segment).toBeGreaterThan(0);
  expect(records.at(-1)?.event).toBe("run.summary");
  expect(warn).not.toHaveBeenCalled();
});

it("保留策略只删除严格命名的已退出运行，不触碰其他文件或活动运行", async () => {
  const oldName = `ompgui-perf-1000000000000-2147483647-${"a".repeat(32)}-000000.jsonl`;
  const liveName = `ompgui-perf-1000000000000-${process.pid}-${"b".repeat(32)}-000000.jsonl`;
  const unrelated = "notes.jsonl";
  const kill = process.kill.bind(process);
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === 2147483647) throw Object.assign(new Error("exited"), { code: "ESRCH" });
    return kill(pid, signal);
  });
  await fs.writeFile(join(directory, oldName), "x".repeat(1800));
  await fs.writeFile(join(directory, liveName), "live");
  await fs.writeFile(join(directory, unrelated), "private");
  const logger = await start({ fileBytes: 1500, directoryBytes: 2500 });
  await logger.close();
  await expect(fs.stat(join(directory, oldName))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(join(directory, liveName), "utf8")).toBe("live");
  expect(await fs.readFile(join(directory, unrelated), "utf8")).toBe("private");
});

it("活动分卷占满目录预算时停止写入，不删除活动数据", async () => {
  const liveName = `ompgui-perf-1000000000000-${process.pid}-${"c".repeat(32)}-000000.jsonl`;
  await fs.writeFile(join(directory, liveName), "x".repeat(1800));
  const warn = vi.fn();
  const logger = await createPerformanceLogger({ directory, getAppMetrics: () => [] }, {
    fileBytes: 1500, directoryBytes: 2500, announce: () => {}, warn,
  });
  expect(logger).toBeUndefined();
  expect(warn).toHaveBeenCalledOnce();
  expect((await fs.stat(join(directory, liveName))).size).toBe(1800);
});

it("异步写入失败只发出一条安全警告，之后所有方法和 close 都不抛错", async () => {
  const warn = vi.fn();
  const logger = await start({ warn });
  vi.spyOn(fs, "appendFile").mockRejectedValue(new Error("private path and credentials"));
  logger.event("engine.exit");
  await expect(logger.close()).resolves.toBeUndefined();
  expect(() => {
    logger.event("engine.exit");
    logger.count("rpc.bytes", 1);
    logger.observe("rpc.duration", 1);
  }).not.toThrow();
  await expect(logger.close()).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith();
});

it("慢盘时 close 在硬截止时间内完成，截止后不启动新写入", async () => {
  const warn = vi.fn();
  const stopped = vi.fn();
  const logger = await start({ closeMs: 20, warn }, stopped);
  let release!: () => void;
  const append = vi.spyOn(fs, "appendFile").mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  logger.event("engine.exit");
  await logger.close();
  expect(warn).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();
  release();
  await Promise.resolve();
  await logger.close();
  expect(append).toHaveBeenCalledOnce();
  expect(stopped).toHaveBeenCalledOnce();
});

it("2 秒采样产生主进程与 Electron 指标，不伪装为 omp 资源", async () => {
  const logger = await createPerformanceLogger({
    directory,
    getAppMetrics: () => [{ pid: 123, type: "Sandbox helper", cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 10, peakWorkingSetSize: 20 } }],
  }, { announce: () => {}, warn: () => {}, sampleMs: 10 });
  expect(logger).toBeDefined();
  loggers.push(logger!);
  await vi.waitFor(async () => {
    // 读盘同时覆盖正常定时刷新，而非只覆盖 close 的强制刷新。
    expect((await readRecords()).some((record) => record.event === "resource.main")).toBe(true);
  }, { timeout: 1000, interval: 20 });
  await logger!.close();
  const records = await readRecords();
  expect(records[0].fields.resourceScope).toBe("electron-only-not-omp");
  expect(records.find((record) => record.event === "resource.main")?.fields).toMatchObject({
    rssBytes: expect.any(Number), cpuUserMicros: expect.any(Number), eventLoopP95Ms: expect.any(Number), eventLoopUtilization: expect.any(Number),
  });
  expect(records.find((record) => record.event === "resource.electron")?.fields).toMatchObject({
    processId: 123, processType: "sandbox-helper", workingSetKiB: 10, peakWorkingSetKiB: 20,
  });
});

it("启动失败不会污染全局单例，关闭后可重新启用", async () => {
  const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  const invalidDirectory = join(directory, "regular-file");
  await fs.writeFile(invalidDirectory, "not a directory");
  expect(await startPerformanceLogging({ directory: invalidDirectory, getAppMetrics: () => [] })).toBeUndefined();
  expect(getPerformanceLogger()).toBeUndefined();
  expect(consoleWarning).toHaveBeenCalledOnce();
  const logger = await startPerformanceLogging({ directory, getAppMetrics: () => [] });
  expect(logger).toBeDefined();
  expect(getPerformanceLogger()).toBe(logger);
  loggers.push(logger!);
  await logger!.close();
  expect(getPerformanceLogger()).toBeUndefined();
});
