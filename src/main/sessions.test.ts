// @vitest-environment node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";
import {
  listNativeSessions,
  readSessionHeader,
  sessionsRoot,
} from "./sessions";

/**
 * 临时替换目录相关环境，避免测试继承用户 profile 或 XDG 路径。
 * 参数：[in] values 测试需要的环境值；[in] operation 隔离环境中执行的操作。
 * 返回值：操作完成后的 Promise；无返回数据。
 */
async function withEnvironment(
  values: Record<string, string>,
  operation: () => void | Promise<void>,
): Promise<void> {
  const keys = [
    "HOME",
    "USERPROFILE",
    "OMP_PROFILE",
    "PI_PROFILE",
    "PI_CONFIG_DIR",
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
    "XDG_DATA_HOME",
  ];
  const saved: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    await operation();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * 验证列表保留标题槽与旧会话，报告空文件和截断文件，严格恢复仍拒绝坏文件。
 * 参数：无。
 * 返回值：所有临时文件清理后的 Promise。
 */
async function catalogueKeepsHealthy(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-catalogue-"));
  try {
    /**
     * 在临时代理目录建立并读取真实 JSONL 会话。
     * 参数：无。
     * 返回值：断言完成后的 Promise。
     */
    async function exercise(): Promise<void> {
      const root = join(temp, "sessions");
      const bucket = join(root, "encoded-cwd");
      await mkdir(bucket, { recursive: true });
      const healthy = join(root, "healthy.jsonl");
      const legacy = join(bucket, "legacy.jsonl");
      const empty = join(root, "empty.jsonl");
      const broken = join(bucket, "broken.jsonl");
      await writeFile(
        healthy,
        [
          JSON.stringify({ type: "title", title: "native title" }),
          JSON.stringify({
            type: "session",
            id: "healthy",
            cwd: temp,
            timestamp: "2026-01-01T00:00:00.000Z",
          }),
          "",
        ].join("\n"),
      );
      await writeFile(
        legacy,
        [
          JSON.stringify({
            type: "session",
            id: "legacy",
            cwd: bucket,
            timestamp: "2026-01-02T00:00:00.000Z",
          }),
          JSON.stringify({
            type: "message",
            message: { role: "user", content: "legacy title" },
          }),
          "",
        ].join("\n"),
      );
      await writeFile(empty, "");
      await writeFile(broken, '{"type":"session","id":');
      const skipped: Array<{ path: string; error: unknown }> = [];
      /**
       * 保存真实列表读取失败的路径和原因供断言。
       * 参数：[in] path 跳过路径；[in] error 原始读取错误。
       * 返回值：无。
       */
      function report(path: string, error: unknown): void {
        skipped.push({ path, error });
      }
      const sessions = await listNativeSessions(temp, "default", report);
      assert.equal(sessions.length, 2);
      const byId = new Map(sessions.map((session) => [session.id, session]));
      assert.equal(byId.get("healthy")?.title, "native title");
      assert.equal(byId.get("healthy")?.cwd, temp);
      assert.equal(byId.get("legacy")?.title, "legacy title");
      assert.equal(byId.get("legacy")?.cwd, bucket);
      assert.deepEqual(
        skipped.map((failure) => failure.path).sort(),
        [empty, broken].sort(),
      );
      for (const failure of skipped) assert.ok(failure.error instanceof Error);
      await assert.rejects(readSessionHeader(empty));
      await assert.rejects(readSessionHeader(broken));
    }
    await withEnvironment({}, exercise);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test(
  "catalogue preserves valid sessions and reports invalid files without weakening resume",
  catalogueKeepsHealthy,
);

/**
 * 验证具名/default profile、显式目录与环境目录的原生优先级和规范化。
 * 参数：无。
 * 返回值：环境恢复后的 Promise。
 */
async function pathPrecedence(): Promise<void> {
  /**
   * 在无用户目录读取的隔离环境中断言纯路径解析。
   * 参数：无。
   * 返回值：无。
   */
  function exercise(): void {
    const config = join(homedir(), ".catalogue-test");
    const named = join(config, "profiles", "work", "agent", "sessions");
    const standard = join(config, "agent", "sessions");
    process.env.PI_CODING_AGENT_DIR = "environment-agent";
    process.env.PI_CODING_AGENT_SESSION_DIR = "unsupported-override";
    assert.equal(sessionsRoot("explicit-agent", " work "), named);
    process.env.OMP_PROFILE = " work ";
    assert.equal(sessionsRoot("explicit-agent"), named);
    assert.equal(sessionsRoot(), named);
    assert.equal(
      sessionsRoot("explicit-agent", " default "),
      join(resolve("explicit-agent"), "sessions"),
    );
    process.env.OMP_PROFILE = "";
    process.env.PI_PROFILE = "work";
    assert.equal(
      sessionsRoot(),
      join(resolve("environment-agent"), "sessions"),
    );
    process.env.PI_CODING_AGENT_DIR = join(config, "profiles", "work", "agent");
    assert.equal(sessionsRoot(), standard);
    delete process.env.OMP_PROFILE;
    assert.equal(sessionsRoot(), named);
    assert.equal(sessionsRoot(undefined, "  "), standard);
    assert.throws(
      () => sessionsRoot(undefined, "../work"),
      /Invalid OMP profile/,
    );
    assert.throws(
      () => sessionsRoot(undefined, "con.txt"),
      /Invalid OMP profile/,
    );
    assert.throws(
      () => sessionsRoot(undefined, "work."),
      /Invalid OMP profile/,
    );
  }
  await withEnvironment({ PI_CONFIG_DIR: ".catalogue-test" }, exercise);
}

test(
  "session paths match native profile normalization and override precedence",
  pathPrecedence,
);

/**
 * 验证具名 profile 与代理目录同时给定时只枚举引擎使用的 profile 根目录。
 * 参数：无。
 * 返回值：临时目录清理且环境恢复后的 Promise。
 */
async function namedProfileCatalogue(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-profile-catalogue-"));
  try {
    /**
     * 建立互不相同的 profile/override 会话以验证真实目录选择。
     * 参数：无。
     * 返回值：断言完成后的 Promise。
     */
    async function exercise(): Promise<void> {
      const override = join(temp, "override-agent");
      const root = join(temp, ".omp", "profiles", "work", "agent", "sessions");
      await mkdir(root, { recursive: true });
      await mkdir(join(override, "sessions"), { recursive: true });
      await writeFile(
        join(root, "native.jsonl"),
        JSON.stringify({ type: "session", id: "native", cwd: temp }) + "\n",
      );
      await writeFile(
        join(override, "sessions", "wrong.jsonl"),
        JSON.stringify({ type: "session", id: "wrong", cwd: temp }) + "\n",
      );
      assert.equal(sessionsRoot(override, "work"), root);
      const sessions = await listNativeSessions(override, "work");
      assert.deepEqual(
        sessions.map((session) => session.id),
        ["native"],
      );
    }
    await withEnvironment({ HOME: temp, USERPROFILE: temp }, exercise);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test(
  "named profile catalogue ignores the engine agent-directory override",
  namedProfileCatalogue,
);

/**
 * 验证原生 XDG sessions 仅在对应 app/profile 目录已存在时启用。
 * 参数：无。
 * 返回值：临时目录清理且环境恢复后的 Promise。
 */
async function migratedXdgPaths(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-xdg-catalogue-"));
  try {
    /**
     * 逐步建立 XDG 默认与具名目录，断言迁移前后的路径和 override 行为。
     * 参数：无。
     * 返回值：断言完成后的 Promise。
     */
    async function exercise(): Promise<void> {
      const xdg = join(temp, "data");
      const config = join(temp, ".omp");
      const platformSupportsXdg =
        process.platform === "linux" || process.platform === "darwin";
      assert.equal(sessionsRoot(), join(config, "agent", "sessions"));
      await mkdir(join(xdg, "omp"), { recursive: true });
      assert.equal(
        sessionsRoot(),
        platformSupportsXdg
          ? join(xdg, "omp", "sessions")
          : join(config, "agent", "sessions"),
      );
      // 默认 XDG 迁移不能把尚未迁移的具名 profile 从原位置挪走。
      assert.equal(
        sessionsRoot(undefined, "work"),
        join(config, "profiles", "work", "agent", "sessions"),
      );
      await mkdir(join(xdg, "omp", "profiles", "work"), { recursive: true });
      assert.equal(
        sessionsRoot("ignored-agent", "work"),
        platformSupportsXdg
          ? join(xdg, "omp", "profiles", "work", "sessions")
          : join(config, "profiles", "work", "agent", "sessions"),
      );
      assert.equal(
        sessionsRoot("explicit-agent", "default"),
        join(resolve("explicit-agent"), "sessions"),
      );
    }
    await withEnvironment(
      {
        HOME: temp,
        USERPROFILE: temp,
        XDG_DATA_HOME: join(temp, "data"),
      },
      exercise,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test(
  "session paths honor only migrated native XDG data directories",
  migratedXdgPaths,
);
