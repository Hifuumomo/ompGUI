import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance, type ELDHistogram } from "node:perf_hooks";

export type PerfFields = Record<string, string | number | boolean | null | undefined>;

export interface PerformanceLogger {
  event(name: string, fields?: PerfFields): void;
  count(name: string, amount: number, fields?: PerfFields): void;
  observe(name: string, value: number, fields?: PerfFields): void;
  close(): Promise<void>;
}

type AppMetric = {
  pid: number;
  type: string;
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number; peakWorkingSetSize: number };
};

type StartOptions = {
  directory: string;
  getAppMetrics: () => readonly AppMetric[];
};

// 仅工厂测试可调预算；集成入口始终使用下述固定上限。
export type PerformanceLogConfiguration = {
  fileBytes?: number;
  directoryBytes?: number;
  bufferBytes?: number;
  reserveBytes?: number;
  aggregateKeys?: number;
  flushMs?: number;
  sampleMs?: number;
  closeMs?: number;
  warn?: () => void;
  announce?: (path: string) => void;
};

type Aggregate = {
  mode: "count" | "observe";
  name: string;
  fields: PerfFields;
  count: number;
  total: number;
  max: number;
};
type PendingRecord = { line: string; bytes: number };

const MiB = 1024 * 1024;
const TOKEN = /^[a-zA-Z0-9_.:@+\-]+$/;
const OWNED_FILE = /^ompgui-perf-(\d{13})-([1-9]\d*)-([a-f0-9]{32})-(\d{6})\.jsonl$/;
let singleton: PerformanceLogger | undefined;
let starting: Promise<PerformanceLogger | undefined> | undefined;

export function getPerformanceLogger(): PerformanceLogger | undefined {
  return singleton;
}

// 模块导入不创建计时器、随机标识、文件或进程钩子；只在显式启动时初始化。
export function startPerformanceLogging(options: StartOptions): Promise<PerformanceLogger | undefined> {
  if (singleton) return Promise.resolve(singleton);
  if (starting) return starting;
  starting = createPerformanceLogger(options, {}, () => { singleton = undefined; })
    .then((logger) => {
      singleton = logger;
      return logger;
    })
    .finally(() => { starting = undefined; });
  return starting;
}

/** 独立工厂用于边界测试；应用只调用 startPerformanceLogging。 */
export async function createPerformanceLogger(
  options: StartOptions,
  configuration: PerformanceLogConfiguration = {},
  onStopped: () => void = () => {},
): Promise<PerformanceLogger | undefined> {
  const fileLimit = configuration.fileBytes ?? 20 * MiB;
  const directoryLimit = configuration.directoryBytes ?? 200 * MiB;
  const bufferLimit = configuration.bufferBytes ?? MiB;
  const reserveLimit = configuration.reserveBytes ?? 64 * 1024;
  const keyLimit = configuration.aggregateKeys ?? 256;
  const closeMs = configuration.closeMs ?? 1000;
  const runId = randomUUID().replaceAll("-", "");
  const stamp = Date.now();
  const origin = performance.now();
  const directory = resolve(options.directory);
  let sequence = 0;
  let currentPath = "";
  let fileSize = 0;
  let stopped = false;
  let closing = false;
  let warned = false;
  let dropped = 0;
  let accepted = 0;
  let bufferedBytes = 0;
  let queue: PendingRecord[] = [];
  let draining: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let flushTimer: NodeJS.Timeout | undefined;
  let sampleTimer: NodeJS.Timeout | undefined;
  let histogram: ELDHistogram | undefined;
  const aggregates = new Map<string, Aggregate>();
  const warn = () => {
    if (warned) return;
    warned = true;
    // 不输出底层异常、用户路径或凭证；日志绝不能使主流程抛错。
    try { (configuration.warn ?? (() => console.warn("[perf] Performance logging disabled; diagnostic output unavailable.")))(); } catch { /* 诊断不可干扰主流程。 */ }
  };
  const stopTimers = () => {
    clearInterval(flushTimer);
    clearInterval(sampleTimer);
    histogram?.disable();
  };
  const disable = () => {
    if (stopped) return;
    stopped = true;
    stopTimers();
    queue = [];
    bufferedBytes = 0;
    aggregates.clear();
    if (!closing) onStopped();
    warn();
  };
  const record = (event: string, fields: PerfFields): PendingRecord => {
    const line = JSON.stringify({
      schemaVersion: 1,
      runId,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.max(0, performance.now() - origin),
      event,
      pid: process.pid,
      fields,
    }) + "\n";
    return { line, bytes: Buffer.byteLength(line) };
  };
  const header = () => record("run.header", {
    segment: sequence,
    resourceScope: "electron-only-not-omp",
    intervalMs: configuration.sampleMs ?? 2000,
    aggregation: "count-total-max",
  });

  // 仅处理严格命名的常规文件；保护其他活动运行和当前分卷，只回收自身已关闭分卷。
  const retain = async () => {
    const names = await fs.readdir(directory);
    const candidates: { path: string; size: number; timestamp: number }[] = [];
    let total = 0;
    for (const name of names) {
      const match = OWNED_FILE.exec(name);
      if (!match) continue;
      const path = join(directory, name);
      let stat;
      try { stat = await fs.lstat(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile()) continue;
      total += stat.size;
      const pid = Number(match[2]);
      let alive = true;
      try { process.kill(pid, 0); } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
      const ownClosedSegment = match[3] === runId && pid === process.pid && path !== currentPath;
      if (!alive || ownClosedSegment) candidates.push({ path, size: stat.size, timestamp: Number(match[1]) });
    }
    candidates.sort((a, b) => a.timestamp - b.timestamp || a.path.localeCompare(b.path));
    for (const candidate of candidates) {
      if (stopped) return;
      if (total + fileLimit <= directoryLimit) break;
      try { await fs.unlink(candidate.path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      total -= candidate.size;
    }
    // 活动运行占满预算时停止本次诊断，不删除他人文件或无限增长当前运行。
    if (total + fileLimit > directoryLimit) throw new Error("perf-budget");
  };
  const rotate = async () => {
    await retain();
    if (stopped) return;
    if (sequence > 999999) throw new Error("perf-segments");
    const initial = header();
    if (initial.bytes >= fileLimit) throw new Error("perf-file-budget");
    currentPath = join(directory, `ompgui-perf-${stamp}-${process.pid}-${runId}-${String(sequence).padStart(6, "0")}.jsonl`);
    sequence += 1;
    await fs.writeFile(currentPath, initial.line, { flag: "wx", mode: 0o600 });
    fileSize = initial.bytes;
  };
  const drain = (): Promise<void> => {
    if (draining) return draining;
    if (stopped || queue.length === 0) return Promise.resolve();
    draining = (async () => {
      while (!stopped && queue.length > 0) {
        if (fileSize + queue[0].bytes > fileLimit) await rotate();
        if (stopped) break;
        const batch: PendingRecord[] = [];
        let bytes = 0;
        while (queue.length > 0 && fileSize + bytes + queue[0].bytes <= fileLimit) {
          const entry = queue.shift()!;
          batch.push(entry);
          bytes += entry.bytes;
        }
        if (batch.length === 0) throw new Error("perf-record-budget");
        // 在途批次仍计入缓冲预算，慢盘不会产生无界 Promise 链或积压。
        await fs.appendFile(currentPath, batch.map((entry) => entry.line).join(""));
        if (stopped) break;
        fileSize += bytes;
        bufferedBytes -= bytes;
      }
    })().catch(disable).finally(() => { draining = undefined; });
    return draining;
  };
  const enqueue = (name: string, fields: PerfFields, critical = false, final = false) => {
    if (stopped) return;
    const entry = record(name, fields);
    const limit = bufferLimit + (critical ? reserveLimit : 0) + (final ? 4096 : 0);
    // 单条最大 8KiB；为每个分卷保留头部空间，避免不可写记录导致旋转循环。
    if (entry.bytes > 8192 || entry.bytes + 512 > fileLimit || bufferedBytes + entry.bytes > limit) {
      dropped += 1;
      return;
    }
    queue.push(entry);
    bufferedBytes += entry.bytes;
    accepted += 1;
  };
  const flushAggregates = () => {
    for (const metric of aggregates.values()) {
      enqueue(`metric.${metric.mode}`, {
        ...metric.fields,
        name: metric.name,
        count: metric.count,
        total: metric.total,
        max: metric.max,
      }, closing);
    }
    aggregates.clear();
  };
  const aggregate = (mode: Aggregate["mode"], name: string, value: number, fields?: PerfFields) => {
    if (stopped || closing) return;
    try {
      if (!validName(name) || !Number.isFinite(value) || Math.abs(value) > 1e15 || value < 0) { dropped += 1; return; }
      const safe = boundedFields(fields);
      if (!safe) { dropped += 1; return; }
      const key = `${mode}:${name}:${JSON.stringify(safe)}`;
      let metric = aggregates.get(key);
      if (!metric) {
        if (aggregates.size >= keyLimit) { dropped += 1; return; }
        metric = { mode, name, fields: safe, count: 0, total: 0, max: 0 };
        aggregates.set(key, metric);
      }
      metric.count = Math.min(1e15, metric.count + 1);
      metric.total = Math.min(1e15, metric.total + value);
      metric.max = Math.max(metric.max, value);
    } catch { dropped += 1; }
  };

  const logger: PerformanceLogger = {
    event(name, fields) {
      if (stopped || closing) return;
      try {
        const safe = boundedFields(fields);
        if (!validName(name) || !safe) { dropped += 1; return; }
        enqueue(name, safe, /(?:start|spawn|handshake|ready|stop|cancel|kill|exit|close|shutdown|summary)/.test(name));
      } catch { dropped += 1; }
    },
    count: (name, amount, fields) => aggregate("count", name, amount, fields),
    observe: (name, value, fields) => aggregate("observe", name, value, fields),
    close() {
      if (closePromise) return closePromise;
      closing = true;
      stopTimers();
      onStopped();
      if (stopped) return (closePromise = Promise.resolve());
      flushAggregates();
      enqueue("run.summary", { acceptedRecords: accepted, droppedRecords: dropped, segments: sequence }, true, true);
      closePromise = new Promise<void>((finish) => {
        // 引用此短计时器以保证 close 的 Promise 能结算；不等待不可取消的慢 I/O。
        const deadline = setTimeout(() => {
          disable();
          finish();
        }, closeMs);
        void drain().then(() => {
          clearTimeout(deadline);
          stopped = true;
          queue = [];
          bufferedBytes = 0;
          finish();
        });
      });
      return closePromise;
    },
  };

  try {
    await fs.mkdir(directory, { recursive: true });
    await rotate();
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    let cpu = process.cpuUsage();
    let sampleOrigin = performance.now();
    let utilization = performance.eventLoopUtilization();
    sampleTimer = setInterval(() => {
      if (stopped || closing) return;
      try {
        flushAggregates();
        const now = performance.now();
        const durationMs = now - sampleOrigin;
        const nextCpu = process.cpuUsage();
        const deltaCpu = { user: nextCpu.user - cpu.user, system: nextCpu.system - cpu.system };
        cpu = nextCpu;
        sampleOrigin = now;
        const memory = process.memoryUsage();
        const nextUtilization = performance.eventLoopUtilization();
        const deltaUtilization = performance.eventLoopUtilization(nextUtilization, utilization);
        utilization = nextUtilization;
        enqueue("resource.main", {
          durationMs,
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
          arrayBuffersBytes: memory.arrayBuffers,
          cpuUserMicros: deltaCpu.user,
          cpuSystemMicros: deltaCpu.system,
          cpuPercent: durationMs > 0 ? (deltaCpu.user + deltaCpu.system) / (durationMs * 10) : 0,
          eventLoopP95Ms: histogram!.count > 0 ? histogram!.percentile(95) / 1e6 : 0,
          eventLoopMaxMs: histogram!.max / 1e6,
          eventLoopUtilization: deltaUtilization.utilization,
        });
        histogram!.reset();
        // Electron 只提供自身进程指标，不将其标记为 omp.exe 或进程树总资源。
        let metrics: readonly AppMetric[];
        try { metrics = options.getAppMetrics(); } catch { enqueue("resource.unavailable", { source: "electron" }); return; }
        for (let index = 0; index < Math.min(metrics.length, 64); index += 1) {
          const metric = metrics[index];
          const fields = boundedFields({
            processId: metric.pid,
            processType: electronProcessCategory(metric.type),
            cpuPercent: metric.cpu.percentCPUUsage,
            workingSetKiB: metric.memory.workingSetSize,
            peakWorkingSetKiB: metric.memory.peakWorkingSetSize,
          });
          if (fields) enqueue("resource.electron", fields);
          else dropped += 1;
        }
      } catch { disable(); }
    }, configuration.sampleMs ?? 2000);
    sampleTimer.unref();
    flushTimer = setInterval(() => { void drain(); }, configuration.flushMs ?? 250);
    flushTimer.unref();
    try { (configuration.announce ?? ((path) => console.info(`[perf] ${path}`)))(currentPath); } catch { /* 控制台失败不影响应用。 */ }
    return logger;
  } catch {
    disable();
    return undefined;
  }
}

function electronProcessCategory(type: string): string {
  switch (type) {
    case "Browser": return "browser";
    case "Tab": return "renderer";
    case "GPU": return "gpu";
    case "Utility": return "utility";
    case "Zygote": return "zygote";
    case "Sandbox helper": return "sandbox-helper";
    case "Pepper Plugin": return "pepper-plugin";
    case "Pepper Plugin Broker": return "pepper-plugin-broker";
    default: return "other";
  }
}

function validName(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 96 && TOKEN.test(value);
}

// 只复制有限的技术标量；拒绝对象、长文本、路径与非有限数字，避免意外记录业务内容。
function boundedFields(fields: PerfFields = {}): PerfFields | undefined {
  const keys = Object.keys(fields);
  if (keys.length > 24) return undefined;
  const safe: PerfFields = Object.create(null) as PerfFields;
  for (const key of keys.sort()) {
    if (!validName(key)) return undefined;
    const value = fields[key];
    if (value === undefined) continue;
    if (value === null || typeof value === "boolean") safe[key] = value;
    else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e15) safe[key] = value;
    else if (typeof value === "string" && validName(value)) safe[key] = value;
    else return undefined;
  }
  return safe;
}
