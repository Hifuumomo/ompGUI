// @vitest-environment node
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test, vi } from "vitest";
import { ToolFilePreviewLedger } from "./tool-preview";
import { readSessionHeader } from "./sessions";

/**
 * 保留真实文件系统，只拦截 open 以控制异步读取边界并观察句柄关闭。
 * 参数：[in] importOriginal Vitest 的原始模块加载器。
 * 返回值：真实文件系统和可控制的 open 方法。
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actualFs = await vi.importActual<typeof fs>("node:fs/promises");
const LIMIT = 512 * 1024;

test("plan compact completion releases maintenance without reauthorizing old evidence", async () => {
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "plan.txt"), "approved");
    const ledger = new ToolFilePreviewLedger();
    ledger.connect(root);
    ledger.beginTransition();
    ledger.beginBackgroundMaintenance();
    ledger.endTransition();
    ledger.endPlanMaintenance();
    ledger.acceptResponse("get_state", {
      sessionId: "native-session", isCompacting: false, isSettled: false,
    }, ledger.requestEpoch());
    const request = { sessionId: "native-session", toolCallId: "execution-read", path: "plan.txt" };
    await assert.rejects(ledger.preview(request, currentState));
    ledger.observe({ type: "tool_execution_start", toolCallId: "execution-read", toolName: "read", args: { path: "plan.txt" } });
    assert.equal((await ledger.preview(request, currentState)).content, "approved");
  });
});

/** 完整历史只授权当前 leaf 的真实工具，压缩前记录可用，旁支和失效响应不可用。 */
test("get_entries restores pre-compaction tool evidence only for the active branch", async () => {
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "before.txt"), "old file");
    await fs.writeFile(join(root, "other.txt"), "other branch");
    const ledger = new ToolFilePreviewLedger();
    ledger.connect(root);
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    const snapshot = {
      entries: [
        {
          type: "message",
          id: "call",
          parentId: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "old-tool",
                name: "read",
                arguments: { path: "before.txt" },
              },
            ],
          },
        },
        {
          type: "compaction",
          id: "compact",
          parentId: "call",
          summary: "压缩",
          timestamp: "2026-10-13T00:00:00Z",
        },
        {
          type: "message",
          id: "other",
          parentId: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "other-tool",
                name: "read",
                arguments: { path: "other.txt" },
              },
            ],
          },
        },
      ],
      leafId: "compact",
    };
    const epoch = ledger.requestEpoch();
    ledger.acceptResponse("get_entries", snapshot, epoch);
    const before = {
      sessionId: "native-session",
      toolCallId: "old-tool",
      path: "before.txt",
    };
    assert.equal(
      (await ledger.preview(before, currentState)).content,
      "old file",
    );
    await assert.rejects(
      ledger.preview(
        {
          sessionId: "native-session",
          toolCallId: "other-tool",
          path: "other.txt",
        },
        currentState,
      ),
    );
    ledger.observe({ type: "session_info_update" });
    ledger.acceptResponse("get_entries", snapshot, epoch);
    await assert.rejects(ledger.preview(before, currentState));
  });
});

/**
 * 建立可显式释放的异步测试边界，避免定时器与竞争断言依赖调度速度。
 * 参数：无。
 * 返回值：等待 Promise 与向其提供结果的函数。
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  /** 保存 Promise 完成器。参数：[in] complete 成功完成函数。返回值：无。 */
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/**
 * 建立独立测试目录并确保句柄 mock 与目录均在失败后恢复。
 * 参数：[in] exercise 接收独立根目录的断言操作。
 * 返回值：断言和清理完成的 Promise。
 */
async function withFiles(
  exercise: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "omp-tool-preview-"));
  vi.mocked(fs.open).mockImplementation(actualFs.open);
  vi.mocked(fs.open).mockClear();
  try {
    await exercise(root);
  } finally {
    vi.mocked(fs.open).mockImplementation(actualFs.open);
    await fs.rm(root, { recursive: true, force: true });
  }
}

/**
 * 用真实原生 get_state 与 assistant toolCall 数据形状建立历史授权。
 * 参数：[in] root CLI 的实际工作目录；[in] path 原生工具 path 参数；[in] id 原生工具 id。
 * 返回值：当前历史工具已授权的独立账本。
 */
function historyLedger(
  root: string,
  path: string,
  id = "call-history",
): ToolFilePreviewLedger {
  const ledger = new ToolFilePreviewLedger();
  ledger.connect(root);
  ledger.acceptResponse(
    "get_state",
    { sessionId: "native-session" },
    ledger.requestEpoch(),
  );
  ledger.acceptResponse(
    "get_messages_page",
    {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id, name: "read", arguments: { path } },
          ],
        },
      ],
      totalMessages: 1,
    },
    ledger.requestEpoch(),
  );
  return ledger;
}

/**
 * 提供真实只读 get_state 返回值契约，不在测试中开放 renderer 自选 cwd 或参数。
 * 参数：无。
 * 返回值：固定当前原生会话的 Promise。
 */
async function currentState(): Promise<{ sessionId: string }> {
  return { sessionId: "native-session" };
}

/**
 * 验证历史分页和 live 完成调用可预览当前文本，普通 state 刷新不撤销证据。
 * 参数：无。
 * 返回值：临时文件清理后的 Promise。
 */
async function historicalAndLiveTargets(): Promise<void> {
  /** 在独立目录断言 native history/live 授权。参数：[in] root 隔离目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "记录.txt"), "工具之后的当前文本\n");
    const ledger = historyLedger(root, "记录.txt:1-4");
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "记录.txt",
    };
    assert.deepEqual(await ledger.preview(request, currentState), {
      path: join(root, "记录.txt"),
      content: "工具之后的当前文本\n",
      byteSize: Buffer.byteLength("工具之后的当前文本\n"),
      truncated: false,
    });
    ledger.observe({
      type: "tool_execution_start",
      toolCallId: "live",
      toolName: "read",
      args: { path: "记录.txt" },
    });
    assert.equal(
      (await ledger.preview({ ...request, toolCallId: "live" }, currentState))
        .content,
      "工具之后的当前文本\n",
    );
    ledger.observe({
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: {
        type: "toolcall_end",
        toolCall: {
          type: "toolCall",
          id: "ending",
          name: "read",
          arguments: '{"path":"记录.txt"}',
        },
      },
    });
    assert.equal(
      (await ledger.preview({ ...request, toolCallId: "ending" }, currentState))
        .truncated,
      false,
    );
    ledger.acceptResponse(
      "get_messages",
      {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "toolcall",
                id: "legacy",
                name: "read",
                arguments: { path: "记录.txt" },
              },
            ],
          },
        ],
      },
      ledger.requestEpoch(),
    );
    assert.equal(
      (await ledger.preview({ ...request, toolCallId: "legacy" }, currentState))
        .byteSize,
      Buffer.byteLength("工具之后的当前文本\n"),
    );
  });
}
test(
  "historical pages, legacy history and complete native live calls authorize current text",
  historicalAndLiveTargets,
);

/**
 * 验证伪造三元组、半截参数、未知工具、非助手载荷与虚拟资源均无文件能力。
 * 参数：无。
 * 返回值：断言及清理完成的 Promise。
 */
async function rejectsUnevidencedTargets(): Promise<void> {
  /** 在独立目录拒绝无原生证据的目标。参数：[in] root 隔离目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "known.txt"), "known");
    const ledger = historyLedger(root, "known.txt");
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    const forged = [
      { ...request, sessionId: "forged-session" },
      { ...request, toolCallId: "forged-id" },
      { ...request, path: "./known.txt" },
      { ...request, path: join(root, "known.txt") },
    ];
    for (const value of forged)
      await assert.rejects(ledger.preview(value, currentState));
    for (const [id, name, args] of [
      ["partial", "read", '{"path":"known.txt"'],
      ["unknown", "unexpected_tool", { path: "known.txt" }],
      ["resource", "read", { path: "artifact://secret" }],
      ["url", "read", { path: "https://example.test/file" }],
      ["archive", "read", { path: "archive.zip:known.txt" }],
    ] as const) {
      ledger.observe({
        type: "tool_execution_start",
        toolCallId: id,
        toolName: name,
        args,
      });
      await assert.rejects(
        ledger.preview({ ...request, toolCallId: id }, currentState),
        /授权/,
      );
    }
    for (const role of ["user", "custom", "toolResult"]) {
      ledger.observe({
        type: "message_end",
        message: {
          role,
          content: [
            {
              type: "toolCall",
              id: role,
              name: "read",
              arguments: { path: "known.txt" },
            },
          ],
        },
      });
      ledger.observe({
        type: "message_update",
        message: { role },
        assistantMessageEvent: {
          type: "toolcall_end",
          toolCall: {
            type: "toolCall",
            id: `${role}-delta`,
            name: "read",
            arguments: { path: "known.txt" },
          },
        },
      });
      await assert.rejects(
        ledger.preview(
          { ...request, toolCallId: `${role}-delta` },
          currentState,
        ),
        /授权/,
      );
      await assert.rejects(
        ledger.preview({ ...request, toolCallId: role }, currentState),
        /授权/,
      );
    }
    ledger.observe({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "streaming",
            name: "read",
            arguments: { path: "known.txt" },
          },
        ],
      },
    });
    await assert.rejects(
      ledger.preview({ ...request, toolCallId: "streaming" }, currentState),
      /授权/,
    );
    assert.equal(vi.mocked(fs.open).mock.calls.length, 0);
  });
}
test(
  "forged targets, partial args, unknown tools and resource-shaped targets never open files",
  rejectsUnevidencedTargets,
);

/**
 * 验证显式授权的 cwd 外文件与 home 相对引用可读取，而不是限制为项目子目录。
 * 参数：无。
 * 返回值：独立目录清理后的 Promise。
 */
async function resolvesNativePaths(): Promise<void> {
  /** 在独立目录解析明确 native cwd/home 路径。参数：[in] root 隔离目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    const cwd = join(root, "workspace");
    await fs.mkdir(cwd);
    const outside = join(root, "external.txt");
    await fs.writeFile(outside, "outside project");
    for (const path of [
      "../external.txt",
      outside,
      `~/${relative(homedir(), outside)}`,
    ]) {
      const ledger = historyLedger(cwd, path);
      const preview = await ledger.preview(
        { sessionId: "native-session", toolCallId: "call-history", path },
        currentState,
      );
      assert.equal(preview.path, outside);
      assert.equal(preview.content, "outside project");
    }
  });
}
test(
  "native relative, absolute and home paths work outside cwd without widening authority",
  resolvesNativePaths,
);

/**
 * 验证读取字节上限、多字节边界与错误后的句柄关闭，不修改原始文件。
 * 参数：无。
 * 返回值：有界读取及目录清理完成的 Promise。
 */
async function boundedUtf8AndFailures(): Promise<void> {
  /** 在独立目录断言有界读取及类型错误。参数：[in] root 隔离目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    const handles: FileHandle[] = [];
    /**
     * 观察真实文件的读取范围和关闭行为，不模拟文件内容。
     * 参数：[in] path 文件路径；[in] flags 只读标志；[in] mode Node 文件权限参数。
     * 返回值：真实且带观察器的文件句柄。
     */
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      vi.spyOn(handle, "close");
      vi.spyOn(handle, "read");
      handles.push(handle);
      return handle;
    });
    const large = Buffer.concat([
      Buffer.alloc(LIMIT - 1, 97),
      Buffer.from("中文"),
    ]);
    await fs.writeFile(join(root, "large.txt"), large);
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "large.txt",
    };
    const preview = await historyLedger(root, "large.txt").preview(
      request,
      currentState,
    );
    assert.equal(preview.content, "a".repeat(LIMIT - 1));
    assert.equal(preview.truncated, true);
    assert.equal(preview.byteSize, large.length);
    const calls = vi.mocked(handles[0].read).mock.calls as unknown[][];
    assert.ok(calls.length > 0);
    let consumed = 0;
    for (const [index, call] of calls.entries()) {
      assert.equal(call[3], consumed);
      assert.equal(typeof call[2], "number");
      assert.ok((call[2] as number) + consumed <= LIMIT + 1);
      const chunk = (await vi.mocked(handles[0].read).mock.results[index]
        .value) as { bytesRead: number };
      consumed += chunk.bytesRead;
    }
    assert.equal(vi.mocked(handles[0].close).mock.calls.length, 1);
    assert.deepEqual(await fs.readFile(join(root, "large.txt")), large);
    for (const [name, bytes] of [
      ["binary", Buffer.from([97, 0, 98])],
      ["invalid", Buffer.from([0xff])],
      ["empty", Buffer.alloc(0)],
      ["exact", Buffer.alloc(LIMIT, 98)],
    ] as const) {
      await fs.writeFile(join(root, name), bytes);
      const ledger = historyLedger(root, name);
      const value = { ...request, path: name };
      if (name === "binary" || name === "invalid")
        await assert.rejects(
          ledger.preview(value, currentState),
          /二进制|UTF-8/,
        );
      else {
        const result = await ledger.preview(value, currentState);
        assert.equal(result.truncated, false);
        assert.equal(Buffer.byteLength(result.content), bytes.length);
      }
      assert.equal(vi.mocked(handles.at(-1)!.close).mock.calls.length, 1);
    }
    for (const name of [
      ".",
      "missing",
      "NUL",
      "\\\\.\\NUL",
      "known.txt:stream",
    ]) {
      const ledger = historyLedger(root, name);
      await assert.rejects(
        ledger.preview({ ...request, path: name }, currentState),
      );
    }
    if (process.platform !== "win32") {
      const ledger = historyLedger(root, "/dev/null");
      await assert.rejects(
        ledger.preview({ ...request, path: "/dev/null" }, currentState),
        /普通文件/,
      );
    }
    // path stat 通过后被替换为目录时，真实 open/fstat 也必须拒绝并关闭已获得句柄。
    const swappedPath = join(root, "swap.txt");
    await fs.writeFile(swappedPath, "before swap");
    let swappedHandle: FileHandle | undefined;
    /**
     * 在真实 stat/open 之间把本测试自己的普通文件替换为目录。
     * 参数：[in] path 授权文件路径；[in] flags 只读打开标志；[in] mode Node 文件权限参数。
     * 返回值：真实文件系统允许打开时的目录句柄；Windows 拒绝目录打开时原样抛错。
     */
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      await fs.rm(swappedPath);
      await fs.mkdir(swappedPath);
      swappedHandle = await actualFs.open(path, flags, mode);
      vi.spyOn(swappedHandle, "close");
      return swappedHandle;
    });
    await assert.rejects(
      historyLedger(root, "swap.txt").preview(
        { ...request, path: "swap.txt" },
        currentState,
      ),
    );
    if (swappedHandle)
      assert.equal(vi.mocked(swappedHandle.close).mock.calls.length, 1);
  });
}
test(
  "preview is bounded read-only strict UTF-8, rejects paths/types, and closes all handles",
  boundedUtf8AndFailures,
);

/**
 * 验证旧连接、同 sessionId 的 leaf 导航及迟到历史不会恢复失效授权。
 * 参数：无。
 * 返回值：断言及清理完成的 Promise。
 */
async function lifecycleAndLateHistory(): Promise<void> {
  /** 在独立目录断言旧生命周期不能恢复文件能力。参数：[in] root 隔离目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "known.txt"), "known");
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    const ledger = historyLedger(root, "known.txt");
    const oldEpoch = ledger.requestEpoch();
    ledger.beginTransition();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    ledger.observe({
      type: "tool_execution_start",
      toolCallId: "call-history",
      toolName: "read",
      args: { path: "known.txt" },
    });
    ledger.endTransition();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "new-session" },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      oldEpoch,
    );
    ledger.acceptResponse(
      "get_messages",
      {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call-history",
                name: "read",
                arguments: { path: "known.txt" },
              },
            ],
          },
        ],
      },
      oldEpoch,
    );
    await assert.rejects(ledger.preview(request, currentState));
    ledger.connect(root);
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    await assert.rejects(ledger.preview(request, currentState), /授权/);
    ledger.observe({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-history",
            name: "read",
            arguments: { path: "known.txt" },
          },
        ],
      },
    });
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "known",
    );
    for (const type of ["session_info_update", "auto_compaction_start"]) {
      ledger.observe({ type });
      await assert.rejects(ledger.preview(request, currentState));
    }
    ledger.observe({ type: "desktop_status", status: "disconnected" });
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    await assert.rejects(ledger.preview(request, currentState));
  });
}
test(
  "transitions, same-session leaf changes, disconnect and stale history invalidate authority",
  lifecycleAndLateHistory,
);

/**
 * 验证真实会话核验失败及读取后等待中的 epoch 变化均拒绝，不泄露已读内容。
 * 参数：无。
 * 返回值：竞争断言及清理完成的 Promise。
 */
async function awaitedReadRaces(): Promise<void> {
  /** 在独立目录控制 native state 和文件等待。参数：[in] root 隔离目录。返回值：竞争断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "known.txt"), "private text");
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    let ledger = historyLedger(root, "known.txt");
    /** 返回已切换的 native 状态。参数：无。返回值：新会话状态的 Promise。 */
    await assert.rejects(
      ledger.preview(request, async () => ({ sessionId: "different" })),
      /原生当前会话/,
    );
    assert.equal(vi.mocked(fs.open).mock.calls.length, 0);
    /** 暴露 native 请求的真实失败。参数：无。返回值：拒绝的 Promise。 */
    await assert.rejects(
      ledger.preview(request, async () => {
        throw new Error("native disconnected");
      }),
      /native disconnected/,
    );
    for (const race of [
      "disconnect",
      "reconnect",
      "leaf",
      "session",
      "compaction",
    ] as const) {
      ledger = historyLedger(root, "known.txt");
      const arrived = deferred<void>();
      const release = deferred<{ sessionId: string }>();
      let reads = 0;
      /**
       * 将第二次 native get_state 暂停在文件已读且句柄已关闭之后。
       * 参数：无。
       * 返回值：当前会话或由测试释放的原生状态。
       */
      async function stateAfterRead(): Promise<{ sessionId: string }> {
        reads += 1;
        if (reads === 1) return { sessionId: "native-session" };
        arrived.resolve();
        return release.promise;
      }
      const result = ledger.preview(request, stateAfterRead);
      const rejected = assert.rejects(result, /失效|读取期间原生会话/);
      await arrived.promise;
      if (race === "disconnect")
        ledger.observe({ type: "desktop_status", status: "error" });
      if (race === "reconnect") {
        ledger.connect(root);
        ledger.acceptResponse(
          "get_state",
          { sessionId: "native-session" },
          ledger.requestEpoch(),
        );
      }
      if (race === "leaf") {
        ledger.beginTransition();
        ledger.endTransition();
      }
      if (race === "compaction") {
        ledger.observe({ type: "auto_compaction_start" });
        ledger.observe({ type: "auto_compaction_end", aborted: false });
      }
      release.resolve({
        sessionId: race === "session" ? "new-session" : "native-session",
      });
      await rejected;
    }
    // 文件打开后的等待同样必须检查代数；拒绝后真实句柄仍须关闭。
    ledger = historyLedger(root, "known.txt");
    const opened = deferred<void>();
    const resumeOpen = deferred<void>();
    let openedHandle: FileHandle | undefined;
    /**
     * 保持真实只读句柄并在返回时制造可控的文件读取等待。
     * 参数：[in] path 原生授权文件路径；[in] flags 只读打开标志；[in] mode Node 文件权限参数。
     * 返回值：在测试释放后返回的真实文件句柄。
     */
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      openedHandle = await actualFs.open(path, flags, mode);
      vi.spyOn(openedHandle, "close");
      opened.resolve();
      await resumeOpen.promise;
      return openedHandle;
    });
    const reading = ledger.preview(request, currentState);
    const refused = assert.rejects(reading, /失效/);
    await opened.promise;
    ledger.beginTransition();
    ledger.endTransition();
    resumeOpen.resolve();
    await refused;
    assert.equal(vi.mocked(openedHandle!.close).mock.calls.length, 1);
  });
}
test(
  "native validation failures and changes after awaited file reads reject already-read text",
  awaitedReadRaces,
);

/**
 * 验证自动维护整段冻结、结束代数撤销与 get_state 压缩状态保护，普通流式仍可看真实文件。
 * 参数：无。
 * 返回值：真实文件消费者断言与临时目录清理完成的 Promise。
 */
async function compactionAuthority(): Promise<void> {
  /** 在隔离目录控制 native 压缩帧与状态。参数：[in] root 测试目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "known.txt"), "native target");
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    const history = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-history",
              name: "read",
              arguments: { path: "known.txt" },
            },
          ],
        },
      ],
    };
    let ledger = historyLedger(root, "known.txt");
    ledger.observe({ type: "auto_compaction_start", reason: "threshold" });
    const duringEpoch = ledger.requestEpoch();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: true },
      duringEpoch,
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    ledger.observe({
      type: "tool_execution_start",
      toolCallId: "call-history",
      toolName: "read",
      args: { path: "known.txt" },
    });
    await assert.rejects(ledger.preview(request, currentState));
    assert.equal(vi.mocked(fs.open).mock.calls.length, 0);
    const acrossEnd = ledger.requestEpoch();
    ledger.observe({ type: "auto_compaction_end", aborted: false });
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false },
      acrossEnd,
    );
    ledger.acceptResponse("get_messages", history, acrossEnd);
    await assert.rejects(ledger.preview(request, currentState));
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isStreaming: true },
      ledger.requestEpoch(),
    );
    await assert.rejects(ledger.preview(request, currentState), /授权/);
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    // 状态流式刷新不应误伤原生已完成工具参数的文件能力。
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isStreaming: true },
      ledger.requestEpoch(),
    );
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "native target",
    );

    // 手动压缩可能没有 auto 帧：可信 get_state 自身必须撤销旧能力并冻结 legacy history。
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: true },
      ledger.requestEpoch(),
    );
    const nativeBusyEpoch = ledger.requestEpoch();
    ledger.acceptResponse("get_messages", history, nativeBusyEpoch);
    await assert.rejects(ledger.preview(request, currentState));
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, nativeBusyEpoch);
    await assert.rejects(ledger.preview(request, currentState), /授权/);
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "native target",
    );

    ledger = historyLedger(root, "known.txt");
    /** 返回正在压缩的真实 state 形状。参数：无。返回值：native busy 状态 Promise。 */
    async function busyState(): Promise<{
      sessionId: string;
      isCompacting: boolean;
    }> {
      return { sessionId: "native-session", isCompacting: true };
    }
    const beforeOpens = vi.mocked(fs.open).mock.calls.length;
    await assert.rejects(ledger.preview(request, busyState), /正在压缩/);
    assert.equal(vi.mocked(fs.open).mock.calls.length, beforeOpens);
    ledger = historyLedger(root, "known.txt");
    let stateReads = 0;
    /** 仅第二次核验观察到手动压缩。参数：无。返回值：对应时刻的原生状态 Promise。 */
    async function compactAfterRead(): Promise<{
      sessionId: string;
      isCompacting: boolean;
    }> {
      stateReads += 1;
      return { sessionId: "native-session", isCompacting: stateReads > 1 };
    }
    await assert.rejects(
      ledger.preview(request, compactAfterRead),
      /读取期间原生会话开始压缩/,
    );
    await assert.rejects(ledger.preview(request, currentState));
  });
}
test(
  "auto and native-state compaction freeze authority without disabling ordinary streaming previews",
  compactionAuthority,
);

/**
 * 验证本地 slash 回执不结束后台维护，admission 内捕获的空闲状态不能解冻当前授权。
 * 参数：无。
 * 返回值：原生完成状态与真实文件消费者断言完成的 Promise。
 */
async function backgroundMaintenanceLifetime(): Promise<void> {
  /** 在隔离目录断言后台维护真实完成边界。参数：[in] root 测试目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    await fs.writeFile(join(root, "known.txt"), "after maintenance");
    const ledger = historyLedger(root, "known.txt");
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    const history = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-history",
              name: "read",
              arguments: { path: "known.txt" },
            },
          ],
        },
      ],
    };
    ledger.beginBackgroundMaintenance();
    ledger.beginTransition();
    const admittedEpoch = ledger.requestEpoch();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isSettled: true },
      admittedEpoch,
    );
    ledger.endTransition();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isSettled: true },
      admittedEpoch,
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    await assert.rejects(ledger.preview(request, currentState));
    ledger.observe({ type: "session_settled" });
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: true, isSettled: true },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    await assert.rejects(ledger.preview(request, currentState));
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isSettled: false },
      ledger.requestEpoch(),
    );
    await assert.rejects(ledger.preview(request, currentState));
    const beforeComplete = ledger.requestEpoch();
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session", isCompacting: false, isSettled: true },
      beforeComplete,
    );
    ledger.acceptResponse("get_messages", history, beforeComplete);
    await assert.rejects(ledger.preview(request, currentState), /授权/);
    // 真实完成后仍需本代历史重新确认工具；普通流式回复不受后台维护旗标影响。
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "after maintenance",
    );
  });
}
test(
  "background slash maintenance requires a fresh post-admission native completion and fresh history",
  backgroundMaintenanceLifetime,
);

/**
 * 验证目录变动只使用可信 native 会话头核实，旧 cwd、错 id 与迟到 header 均不能用于相对路径。
 * 参数：无。
 * 返回值：隔离原生头与实际文件消费者断言完成的 Promise。
 */
async function nativeWorkspaceRevalidation(): Promise<void> {
  /** 建立不同内容的旧/新 cwd 并读取真实只读会话头。参数：[in] root 测试目录。返回值：断言完成的 Promise。 */
  await withFiles(async (root) => {
    const oldCwd = join(root, "old");
    const newCwd = join(root, "new");
    await fs.mkdir(oldCwd);
    await fs.mkdir(newCwd);
    await fs.writeFile(join(oldCwd, "known.txt"), "wrong old cwd");
    await fs.writeFile(join(newCwd, "known.txt"), "actual new cwd");
    const sessionFile = join(root, "native.jsonl");
    await fs.writeFile(
      sessionFile,
      JSON.stringify({ type: "session", id: "native-session", cwd: newCwd }) +
        "\n",
    );
    const header = await readSessionHeader(sessionFile);
    const request = {
      sessionId: "native-session",
      toolCallId: "call-history",
      path: "known.txt",
    };
    const history = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-history",
              name: "read",
              arguments: { path: "known.txt" },
            },
          ],
        },
      ],
    };
    const ledger = historyLedger(oldCwd, "known.txt");
    const beforeMove = ledger.requestEpoch();
    ledger.invalidateWorkspace(true);
    ledger.beginTransition();
    ledger.endTransition();
    assert.equal(ledger.needsWorkspaceHeader(), true);
    ledger.acceptWorkspace(header, "native-session", beforeMove);
    assert.equal(ledger.needsWorkspaceHeader(), true);
    /** 提交错会话的 header 证据。参数：无。返回值：无；核实失败抛错。 */
    assert.throws(
      () =>
        ledger.acceptWorkspace(header, "wrong-session", ledger.requestEpoch()),
      /核实/,
    );
    /** 提交缺失 cwd 的 header 证据。参数：无。返回值：无；核实失败抛错。 */
    assert.throws(
      () =>
        ledger.acceptWorkspace(
          { id: "native-session", cwd: "" },
          "native-session",
          ledger.requestEpoch(),
        ),
      /核实/,
    );
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    await assert.rejects(
      ledger.preview(request, currentState),
      /工作目录已改变/,
    );
    const verifiedEpoch = ledger.requestEpoch();
    ledger.acceptWorkspace(header, "native-session", verifiedEpoch);
    assert.equal(ledger.needsWorkspaceHeader(), false);
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "actual new cwd",
    );
    ledger.observe({
      type: "session_info_update",
      title: "ordinary rename",
      sessionId: "native-session",
    });
    assert.equal(ledger.needsWorkspaceHeader(), false);
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    assert.equal(
      (await ledger.preview(request, currentState)).path,
      join(newCwd, "known.txt"),
    );

    // typed switch/open 的不可证实 native cwd fallback 不用任意 header 猜测，只能重连恢复相对读取。
    ledger.invalidateWorkspace(false);
    ledger.acceptWorkspace(header, "native-session", ledger.requestEpoch());
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    await assert.rejects(ledger.preview(request, currentState), /重新连接/);
    ledger.observe({
      type: "tool_execution_start",
      toolCallId: "absolute",
      toolName: "read",
      args: { path: join(newCwd, "known.txt") },
    });
    assert.equal(
      (
        await ledger.preview(
          {
            ...request,
            toolCallId: "absolute",
            path: join(newCwd, "known.txt"),
          },
          currentState,
        )
      ).content,
      "actual new cwd",
    );
    ledger.connect(newCwd);
    ledger.acceptResponse(
      "get_state",
      { sessionId: "native-session" },
      ledger.requestEpoch(),
    );
    ledger.acceptResponse("get_messages", history, ledger.requestEpoch());
    assert.equal(
      (await ledger.preview(request, currentState)).content,
      "actual new cwd",
    );
  });
}
test(
  "native cwd mutations require current matching header evidence or an explicit reconnect",
  nativeWorkspaceRevalidation,
);
