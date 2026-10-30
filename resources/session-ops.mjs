import { open } from "node:fs/promises";

/**
 * 读取会话文件头标识，跳过首行标题槽。
 * 参数：[in] path 会话 JSONL 路径。
 * 返回值：首个非标题条目的 id；前 64 KiB 内无条目时为 undefined。
 */
export async function readSessionHeaderId(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.toString("utf8", 0, bytesRead).split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.type === "title") continue;
      return entry.id;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * 注册侧边栏会话重命名与删除；先取得原生独占租约，被占用即拒绝。
 * 参数：[in] api 原生 ExtensionAPI；[in] reply 相关结果回传；[in] loadSessionManager 加载原生会话管理器模块。
 * 返回值：无。
 */
export function registerSessionOps(api, reply, loadSessionManager) {
  api.registerCommand("ompgui-session", {
    description: "取得原生独占租约后重命名或删除会话文件",
    async handler(args, ctx) {
      let request;
      let release;
      try {
        request = JSON.parse(args);
        if (
          typeof request.requestId !== "string" ||
          typeof request.path !== "string" ||
          typeof request.sessionId !== "string" ||
          !["rename", "delete"].includes(request.op)
        )
          throw new Error("无效的会话操作参数");
        if (
          request.op === "rename" &&
          (typeof request.name !== "string" || !request.name.trim())
        )
          throw new Error("会话名称不能为空");
        if (ctx.agent.kind !== "main") throw new Error("GUI 桥接仅支持主会话");
        const { FileSessionStorage, tryAcquireSessionLease } = api.pi;
        if (!FileSessionStorage || !tryAcquireSessionLease)
          throw new Error("当前 omp 不支持安全会话占用检测，请更新引擎后重试");
        // 显式探测使 claimSession 的锁不可用降级不能掩盖占用。
        const probe = tryAcquireSessionLease(request.sessionId);
        if (!probe)
          throw new Error(
            "SESSION_OCCUPIED：该会话正在被其他 omp 实例使用，请结束占用后重试。",
          );
        probe.release();
        const storage = new FileSessionStorage();
        release = storage.claimSession(request.sessionId, request.path);
        if (!release)
          throw new Error("SESSION_OCCUPIED：会话已被占用或文件身份已改变。");
        if ((await readSessionHeaderId(request.path)) !== request.sessionId)
          throw new Error("会话文件已改变，请刷新会话列表后重试");
        if (request.op === "delete") {
          await storage.deleteSessionWithArtifacts(request.path);
        } else {
          // 原生改名同时追加审计条目并更新标题槽；无槽位旧文件走原子重写。
          const { SessionManager } = await loadSessionManager();
          const manager = await SessionManager.open(
            request.path,
            undefined,
            storage,
            { throwIfMissing: true },
          );
          try {
            if (manager.getSessionId() !== request.sessionId)
              throw new Error("会话文件已改变，请刷新会话列表后重试");
            if (!(await manager.setSessionName(request.name, "user")))
              throw new Error("会话名称无效");
          } finally {
            await manager.close();
          }
        }
        reply(ctx, request.requestId, { ok: true, data: {} });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        release?.();
      }
    },
  });
}
