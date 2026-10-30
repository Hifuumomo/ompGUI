// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ProjectCache, projectCacheBudget } from "./project-cache";

const load = (cache: ProjectCache, key: string) =>
  cache.load({
    key,
    version: "1",
    read: async () => key,
    valid: async () => true,
  });

it("字节预算内按最近使用顺序淘汰，访问不会重复计入占用", async () => {
  const probe = new ProjectCache(Infinity);
  await load(probe, "a");
  const cache = new ProjectCache(probe.usage.bytes * 2);
  await load(cache, "a");
  await load(cache, "b");
  await load(cache, "a");
  await load(cache, "c");
  const read = vi.fn(async () => "b");
  await cache.load({ key: "b", version: "1", read, valid: async () => true });
  expect(read).toHaveBeenCalledOnce();
  expect(cache.usage).toEqual({ entries: 2, bytes: probe.usage.bytes * 2 });
});

it("超大文件完整返回但不缓存；0 可关闭持久缓存", async () => {
  for (const budget of [0, 100]) {
    const cache = new ProjectCache(budget);
    const value = "large".repeat(1000);
    expect(
      await cache.load({
        key: "big",
        version: "1",
        read: async () => value,
        valid: async () => true,
      }),
    ).toBe(value);
    expect(cache.usage).toEqual({ entries: 0, bytes: 0 });
  }
  expect(projectCacheBudget("0")).toBe(0);
  expect(() => projectCacheBudget("bad")).toThrow("OMP_PROJECT_CACHE_MB");
});

it("相同版本的并发请求合并，失败明确返回且不缓存", async () => {
  const cache = new ProjectCache(4096);
  let finish!: (value: string) => void;
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const spec = { key: "a", version: "1", read, valid: async () => true };
  const first = cache.load(spec);
  const second = cache.load(spec);
  finish("content");
  expect(await Promise.all([first, second])).toEqual(["content", "content"]);
  expect(read).toHaveBeenCalledOnce();
  const broken = {
    ...spec,
    version: "2",
    read: vi.fn(async () => {
      throw new Error("read failed");
    }),
  };
  await expect(cache.load(broken)).rejects.toThrow("read failed");
  await expect(cache.load(broken)).rejects.toThrow("read failed");
  expect(broken.read).toHaveBeenCalledTimes(2);
  expect(cache.usage.entries).toBe(0);
});

it("加载期间版本变化时不缓存旧快照，多个历史版本只保留最新项", async () => {
  const cache = new ProjectCache(4096);
  const spec = {
    key: "a",
    version: "1",
    read: async () => "old",
    valid: async () => false,
  };
  expect(await cache.load(spec)).toBe("old");
  expect(cache.usage.entries).toBe(0);
  await cache.load({ ...spec, valid: async () => true });
  expect(
    await cache.load({
      ...spec,
      version: "2",
      read: async () => "new",
      valid: async () => true,
    }),
  ).toBe("new");
  expect(cache.usage.entries).toBe(1);
});
