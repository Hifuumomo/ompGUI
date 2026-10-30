// @vitest-environment node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { SessionReader } from "./session-reader";
import { listNativeSessions, readSessionHeader, sessionsRoot } from "./sessions";

/**
 * 在测试数据库建立与原生相同的 recap 表。
 * 参数：[in] path 测试数据库路径。
 * 返回值：调用方负责关闭的可写测试连接。
 */
function fixtureDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE session_recaps(id INTEGER PRIMARY KEY, session_id TEXT, cwd TEXT, recap TEXT, created_at INTEGER)");
  return db;
}

/**
 * 验证最新记录排序、session/cwd 隔离、完整内容、只读性和数据库独立轮询。
 * 参数：无。
 * 返回值：测试与临时资源清理完成后的 Promise。
 */
async function latestStoredRecap(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-recaps-"));
  try {
    const root = join(temp, "sessions");
    await mkdir(root);
    const file = join(root, "session.jsonl");
    await writeFile(file, JSON.stringify({ type: "session", id: "same", cwd: temp }) + "\n");
    const database = join(temp, "history.db");
    const db = fixtureDatabase(database);
    const full = "# 原生完整 recap\n" + "长内容，不截断。".repeat(3000);
    try {
      const insert = db.prepare("INSERT INTO session_recaps VALUES (?, ?, ?, ?, ?)");
      insert.run(1, "same", temp, "older", 100);
      insert.run(2, "same", temp, "same timestamp older id", 200);
      insert.run(3, "same", temp, full, 200);
      insert.run(4, "same", temp, "newer id but older timestamp", 50);
      insert.run(5, "other", temp, "wrong session", 900);
      insert.run(6, "same", join(temp, "other"), "wrong cwd", 1000);
      const before = await readFile(database);
      const summary = await readSessionHeader(file, database);
      assert.deepEqual(summary.recap, { text: full, createdAt: 200 });
      const sessions = await listNativeSessions(temp, "default");
      assert.deepEqual(sessions[0].recap, summary.recap);
      assert.deepEqual(await readFile(database), before);
      const reader = new SessionReader(join(temp, "blobs"));
      assert.deepEqual((await reader.read(file))?.summary.recap, summary.recap);
      assert.equal(await reader.read(file), null);
      // 数据库更新不触碰 JSONL，轮询也必须交付新的 recap。
      insert.run(7, "same", temp, "new recap", 300);
      assert.deepEqual((await reader.read(file))?.summary.recap, { text: "new recap", createdAt: 300 });
      assert.equal(await reader.read(file), null);
      db.prepare("DELETE FROM session_recaps WHERE session_id = ? AND cwd = ?").run("same", temp);
      assert.equal((await reader.read(file))?.summary.recap, undefined);
    } finally {
      db.close();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("stored native recaps use timestamp/id ordering, exact identity and independent polling", latestStoredRecap);

/**
 * 验证缺库、缺表均正常且不创建数据，坏库可报告而不阻断历史。
 * 参数：无。
 * 返回值：测试与临时资源清理完成后的 Promise。
 */
async function unavailableRecapStorage(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-recaps-absent-"));
  try {
    await mkdir(join(temp, "sessions"));
    const file = join(temp, "sessions", "native.jsonl");
    await writeFile(file, JSON.stringify({ type: "session", id: "native", cwd: temp }) + "\n");
    const database = join(temp, "history.db");
    const errors: unknown[] = [];
    /**
     * 收集数据库读取报告。
     * 参数：[in] path 错误路径；[in] error 原始错误。
     * 返回值：无。
     */
    function report(path: string, error: unknown): void {
      assert.equal(path, database);
      errors.push(error);
    }
    assert.equal((await readSessionHeader(file, database, report)).recap, undefined);
    assert.equal((await listNativeSessions(temp, "default", report)).length, 1);
    assert.equal(existsSync(database), false);
    const empty = new DatabaseSync(database);
    empty.close();
    const before = await readFile(database);
    assert.equal((await readSessionHeader(file, database, report)).recap, undefined);
    assert.equal((await listNativeSessions(temp, "default", report)).length, 1);
    assert.deepEqual(await readFile(database), before);
    assert.deepEqual(errors, []);
    await writeFile(database, "not a SQLite database");
    assert.equal((await listNativeSessions(temp, "default", report)).length, 1);
    assert.equal(errors.length, 1);
    const reader = new SessionReader(join(temp, "blobs"), report);
    assert.equal((await reader.read(file))?.summary.id, "native");
    assert.equal(errors.length, 2);
    assert.equal((await readFile(database)).toString(), "not a SQLite database");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("absent recap storage stays absent and corrupt storage does not hide history", unavailableRecapStorage);

/**
 * 验证 recap 数据库和 sessionsRoot 使用同一 profile、agentDir、XDG 路由。
 * 参数：无。
 * 返回值：环境还原和临时目录清理完成后的 Promise。
 */
async function routedRecapStorage(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), "omp-recaps-routing-"));
  const saved = { ...process.env };
  try {
    for (const key of ["OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "XDG_DATA_HOME"]) delete process.env[key];
    process.env.HOME = temp;
    process.env.USERPROFILE = temp;
    process.env.PI_CONFIG_DIR = ".omp";
    process.env.XDG_DATA_HOME = join(temp, "data");
    await mkdir(join(temp, "data", "omp", "profiles", "work"), { recursive: true });
    for (const profile of ["default", "work"]) {
      const override = join(temp, "override");
      const root = sessionsRoot(override, profile);
      await mkdir(root, { recursive: true });
      const database = join(dirname(root), "history.db");
      const db = fixtureDatabase(database);
      try {
        db.prepare("INSERT INTO session_recaps VALUES (1, 'native', ?, ?, 123)").run(temp, profile);
      } finally {
        db.close();
      }
      const file = join(root, "native.jsonl");
      await writeFile(file, JSON.stringify({ type: "session", id: "native", cwd: temp }) + "\n");
      assert.equal((await listNativeSessions(override, profile))[0].recap?.text, profile);
      // 显式打开导入路径也使用当前配置的历史库，而不是导入文件所在目录。
      const imported = join(temp, `imported-${profile}.jsonl`);
      await writeFile(imported, await readFile(file));
      const reader = new SessionReader(join(dirname(root), "blobs"));
      assert.equal((await reader.read(imported))?.summary.recap?.text, profile);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(temp, { recursive: true, force: true });
  }
}

test("recap storage follows native profile, agentDir and migrated XDG routing", routedRecapStorage);
