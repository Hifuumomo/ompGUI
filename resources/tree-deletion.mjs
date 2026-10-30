import { randomUUID } from "node:crypto";

/** 只删除确认的完整子树；清理指向已删除目标的标签并接回其保留的子节点。 */
export function pruneTreeEntries(entries, leafId, request) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (!byId.has(request.entryId))
    throw new Error("待删除节点已不存在，请刷新会话树");
  const children = new Map();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry.id);
    children.set(entry.parentId, siblings);
  }
  const removed = new Set();
  const pending = [request.entryId];
  while (pending.length) {
    const id = pending.pop();
    if (removed.has(id)) continue;
    removed.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  if (
    !Array.isArray(request.entryIds) ||
    request.entryIds.length !== removed.size ||
    new Set(request.entryIds).size !== removed.size ||
    request.entryIds.some((id) => !removed.has(id))
  )
    throw new Error("待删除子树已变化，请重新确认");
  const count = removed.size;
  for (const entry of entries)
    if (entry.type === "label" && removed.has(entry.targetId))
      removed.add(entry.id);
  function retainedParent(id) {
    const seen = new Set();
    while (id && removed.has(id)) {
      if (seen.has(id)) throw new Error("会话父节点存在循环");
      seen.add(id);
      id = byId.get(id)?.parentId ?? null;
    }
    return id;
  }
  return {
    count,
    leafId: retainedParent(leafId),
    entries: entries
      .filter((entry) => !removed.has(entry.id))
      .map((entry) =>
        removed.has(entry.parentId)
          ? { ...entry, parentId: retainedParent(entry.parentId) }
          : entry,
      ),
  };
}

/** 在同一原生租约内用会话管理器原子重写，再通过原生切换刷新运行时上下文。 */
export async function deleteTreeBranch(api, ctx, session, request) {
  const manager = session.sessionManager;
  if (!ctx.isIdle()) throw new Error("请等待会话空闲后删除节点");
  if (request.sessionId !== manager.getSessionId())
    throw new Error("会话已变化，请重新打开会话树");
  for (const method of [
    "captureState",
    "restoreState",
    "rewriteEntries",
    "flush",
  ])
    if (typeof manager[method] !== "function")
      throw new Error("当前 omp 不支持安全删除会话节点，请更新引擎");
  const file = manager.getSessionFile();
  if (!file || !api.pi.FileSessionStorage)
    throw new Error("当前会话尚未持久化，无法删除节点");
  const release = new api.pi.FileSessionStorage().claimSession(
    request.sessionId,
    file,
  );
  if (!release) throw new Error("SESSION_OCCUPIED：无法取得当前会话的独占租约");
  try {
    await manager.flush();
    const snapshot = manager.captureState();
    const originalLeaf = manager.getLeafId();
    const result = pruneTreeEntries(
      snapshot.entries,
      manager.getLeafId(),
      request,
    );
    // 元数据标记保持删除后的真实分支末端，避免重启时误选另一条保留分支。
    const marker = {
      type: "custom",
      id: randomUUID(),
      parentId: result.leafId,
      timestamp: new Date().toISOString(),
      customType: "ompgui-tree-pruned",
      data: { entryId: request.entryId, removedCount: result.count },
    };
    try {
      manager.restoreState({
        ...snapshot,
        entries: [...result.entries, marker],
        needsRewrite: true,
      });
      await manager.rewriteEntries();
      const switched = await ctx.switchSession(file);
      if (switched?.cancelled)
        throw new Error("原生扩展取消了删除后的会话重载");
    } catch (error) {
      const disk = manager.captureState();
      manager.restoreState({
        ...snapshot,
        expectedDiskSize: disk.expectedDiskSize,
        needsRewrite: true,
      });
      if (originalLeaf) manager.branch(originalLeaf);
      else manager.resetLeaf();
      try {
        await manager.rewriteEntries();
      } catch (rollbackError) {
        throw new Error(
          `删除失败且恢复失败：${error.message}；${rollbackError.message}`,
        );
      }
      throw error;
    }
    return { removedCount: result.count };
  } finally {
    release();
  }
}
