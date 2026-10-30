import type { ProjectDiff } from "../shared/project-browser";

type Value = string | ProjectDiff;
const STRING_BYTES = 2;
const ENTRY_BYTES = 512;
const ROW_BYTES = 192;
const MEBIBYTE = 1024 * 1024;
export const DEFAULT_PROJECT_CACHE_BYTES = 32 * MEBIBYTE;

export function projectCacheBudget(setting?: string): number {
  if (setting === undefined) return DEFAULT_PROJECT_CACHE_BYTES;
  const mib = Number(setting);
  if (!Number.isFinite(mib * MEBIBYTE) || mib < 0 || setting.trim() === "")
    throw new Error("OMP_PROJECT_CACHE_MB 必须为非负数（0 禁用缓存）");
  return mib * MEBIBYTE;
}

function valueBytes(value: Value): number {
  if (typeof value === "string") return value.length * STRING_BYTES;
  return (
    (value.before.length + value.after.length) * STRING_BYTES +
    value.rows.reduce(
      (sum, row) =>
        sum + ROW_BYTES + (row.text.length + row.ending.length) * STRING_BYTES,
      0,
    )
  );
}

interface Load<T> {
  readonly key: string;
  readonly version: string;
  readonly read: () => Promise<T>;
  readonly valid: () => Promise<boolean>;
}
interface Entry {
  readonly version: string;
  readonly value: Value;
  readonly bytes: number;
}

/** 源码和 Diff 共用字节预算；超预算只淘汰缓存，不截断阅读内容。 */
export class ProjectCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Value>>();
  private bytes = 0;
  constructor(private readonly budget: number) {}

  get usage() {
    return { bytes: this.bytes, entries: this.entries.size };
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private store<T extends Value>(spec: Load<T>, value: T) {
    const bytes =
      ENTRY_BYTES +
      (spec.key.length + spec.version.length) * STRING_BYTES +
      valueBytes(value);
    this.delete(spec.key);
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget)
      this.delete(this.entries.keys().next().value!);
    this.entries.set(spec.key, { version: spec.version, value, bytes });
    this.bytes += bytes;
  }

  async load<T extends Value>(spec: Load<T>): Promise<T> {
    const entry = this.entries.get(spec.key);
    if (entry?.version === spec.version) {
      this.entries.delete(spec.key);
      this.entries.set(spec.key, entry);
      return entry.value as T;
    }
    this.delete(spec.key);
    const pendingKey = JSON.stringify([spec.key, spec.version]);
    const existing = this.pending.get(pendingKey);
    if (existing) return existing as Promise<T>;
    const task = this.readFresh(spec).finally(() =>
      this.pending.delete(pendingKey),
    );
    this.pending.set(pendingKey, task);
    return task;
  }

  private async readFresh<T extends Value>(spec: Load<T>): Promise<T> {
    const value = await spec.read();
    if (await spec.valid()) this.store(spec, value);
    return value;
  }
}
