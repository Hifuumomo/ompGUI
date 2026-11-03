import type { ToolEvidence } from "../transcript-types";
import type { AgentMessage } from "../../../shared/protocol";

let fixtureSequence = 0;

/** 构造确定顺序的历史工具证据，不依赖随机数或时钟。参数：[in] name 工具名；[in] args 参数；[in] result 原生结果字段。返回值：工具证据。 */
export function tool(
  name: string,
  args: unknown,
  result: { details?: unknown; text?: string; isError?: boolean },
): ToolEvidence {
  const id = `call_${name}_${++fixtureSequence}`;
  return {
    id,
    name,
    args,
    resultMessage: {
      role: "toolResult",
      toolName: name,
      toolCallId: id,
      isError: result.isError ?? false,
      content: [{ type: "text", text: result.text ?? "" }],
      details: result.details,
      timestamp: 1793693433522,
    } as AgentMessage,
  };
}

export const editOk = tool(
  "edit",
  {
    path: "src/main/rpc.ts",
    old_string: "const TIMEOUT_MS = 30_000;",
    new_string: "const TIMEOUT_MS = options.timeoutMs ?? 30_000;",
  },
  {
    details: {
      op: "update",
      path: "src/main/rpc.ts",
      firstChangedLine: 42,
      diff: ' 41|const child = spawn(executable, args, {\n-42|const TIMEOUT_MS = 30_000;\n+42|const TIMEOUT_MS = options.timeoutMs ?? 30_000;\n+43|if (TIMEOUT_MS <= 0) throw new RangeError("timeoutMs");\n 44|\n\n 88|  timeoutMs?: number;',
    },
    text: "Successfully replaced text in src/main/rpc.ts.",
  },
);

export const editFailed = tool(
  "edit",
  { path: "src/main/rpc.ts", old_string: "x", new_string: "y" },
  {
    details: { diff: "", errorKind: "no_match" },
    text: "old_string 在文件中出现 0 次",
    isError: true,
  },
);

export const editDelete = tool(
  "edit",
  {
    input:
      "*** Begin Patch\n[src/renderer/parity-smoke.js#4B78]\nREM\n*** End Patch\n",
  },
  {
    details: {
      op: "delete",
      path: "C:/Code/ompGUI/src/renderer/parity-smoke.js",
      diff: "",
      oldText:
        "// Disposable browser verification module; removed before delivery.\nimport React, { Profiler } from 'react';\nimport { createRoot } from 'react-dom/client';\n",
    },
    text: "Deleted src/renderer/parity-smoke.js",
  },
);

export const editMove = tool(
  "edit",
  {
    input:
      "*** Begin Patch\n[README.md#73E7]\nMV docs/README.md\n*** End Patch\n",
  },
  {
    details: {
      diff: "-3|任务目录名称沿用历史名称。\n+3|实验目录与报告使用数据名标识。",
      firstChangedLine: 3,
    },
    text: "[docs/README.md#0BD1]",
  },
);

export const bashOk = tool(
  "bash",
  { command: "npm run test -- rpc", timeout: 300 },
  {
    details: { exitCode: 0, timeoutSeconds: 300, wallTimeMs: 12400 },
    text: " ✓ src/main/rpc.test.ts (14 tests) 812ms\n\n Test Files  2 passed (2)\n      Tests  20 passed (20)",
  },
);

export const bashFailed = tool(
  "bash",
  { command: "npm run typecheck" },
  {
    details: { exitCode: 2, timeoutSeconds: 300, wallTimeMs: 4100 },
    text: "src/main/rpc.ts:43:9 - error TS2304: Cannot find name 'options'.\n\nFound 1 error in src/main/rpc.ts:43",
    isError: true,
  },
);

export const bashBackground = tool(
  "bash",
  { command: "npm run check", timeout: 300, async: true },
  {
    details: {
      async: { state: "running", jobId: "bg_1", type: "bash" },
      timeoutSeconds: 300,
    },
    text: "Backgrounded as job bg_1 (killed once it has run 300s in total; `timeout: 0` disables the deadline); its output is injected into the conversation as a follow-up the moment it finishes.",
  },
);

export const bashServiceTimeout = tool(
  "bash",
  {
    command: "python src/temp/server.py",
    async: true,
    name: "image-editor",
    ready: { log: "running on", port: 8765, timeout: 15 },
  },
  {
    details: {
      service: {
        name: "image-editor",
        state: "starting",
        ready: false,
        timedOut: true,
        pid: 17500,
      },
    },
    text: "image-editor: starting pid=17500\nNOT ready — readiness timed out after 15s; process state: starting.",
  },
);

const daemon = {
  name: "train",
  id: "19c9dcf0",
  state: "ready",
  pid: 14640,
  createdAt: 1789115959962,
  startedAt: 1789115959964,
  readyAt: 1789115960146,
  restartCount: 0,
  readyMatch: "preparing",
};
export const hubStart = tool(
  "hub",
  { op: "start", name: "train", application: "python", args: ["train.py"] },
  {
    details: { op: "start", daemon, timedOut: false },
    text: "Started train: ready pid=14640 uptime=220ms restarts=0\nReady log matched: preparing",
  },
);
export const hubStop = tool(
  "hub",
  { op: "stop", name: "train", timeout: 30 },
  {
    details: {
      op: "stop",
      daemon: {
        ...daemon,
        state: "exited",
        pid: undefined,
        exitedAt: 1789116656444,
        exitCode: 1,
      },
    },
    text: "Stopped train: exited exit=1 uptime=11m36s restarts=0",
  },
);
export const procKill = tool(
  "write",
  { path: "proc://parity-ui-data/kill", content: null },
  {
    details: {
      proc: {
        action: "stop",
        daemon: {
          ...daemon,
          name: "parity-ui-data",
          state: "exited",
          startedAt: 1793693806003,
          exitedAt: 1793694413806,
          exitCode: 1,
        },
      },
    },
    text: "Stopped parity-ui-data [service] — exited — up 10m7s",
  },
);
export const hubCancel = tool(
  "hub",
  { op: "cancel", ids: ["bg_5"] },
  {
    details: {
      op: "cancel",
      jobs: [
        {
          id: "bg_5",
          type: "bash",
          status: "cancelled",
          label: "ssh lab 'wait-train.sh'",
          durationMs: 1071840,
        },
      ],
      cancelled: [{ id: "bg_5", status: "cancelled" }],
    },
    text: "## Cancelled (1)\n\n- Cancelled background job bg_5.",
  },
);
export const hubLogs = tool(
  "hub",
  { op: "logs", name: "train", lines: 30 },
  {
    details: {
      op: "logs",
      cursor: 94,
      timedOut: false,
      state: "ready",
      terminalRows: ["\u001b[0mpreparing"],
    },
    text: "preparing\n[train: ready; cursor=94]",
  },
);
export const hubList = tool(
  "hub",
  { op: "ps" },
  {
    details: {
      op: "list",
      daemons: [{ ...daemon, name: "timer", pid: 17856 }],
    },
    text: "- timer: ready pid=17856 uptime=13.9s restarts=0",
  },
);
export const hubWait = tool(
  "hub",
  { op: "wait", name: "train", pattern: "preprocessing|Error", timeout: 600 },
  {
    details: { op: "wait", daemon, timedOut: false },
    text: "train: ready pid=14640 uptime=4.0s restarts=0\nMatched: preprocessing",
  },
);
export const hubInbox = tool(
  "hub",
  { op: "inbox" },
  { details: { op: "inbox", from: "Main", inbox: [] }, text: "Inbox empty." },
);
export const hubInvalid = tool(
  "hub",
  { name: "timer", application: "bash" },
  {
    details: {
      isError: true,
      error:
        'Validation failed for tool "hub":\n  - op: op must be hub operation (was missing)',
    },
    text: 'Validation failed for tool "hub":\n  - op: op must be hub operation (was missing)',
    isError: true,
  },
);

export const agentSend = tool(
  "write",
  {
    path: "agent://BaselineRecord",
    content:
      "Parent live capture complete. Q1 events toolcall_start/delta/end.",
  },
  {
    details: {
      message: {
        op: "send",
        from: "Main",
        to: "BaselineRecord",
        receipts: [{ to: "BaselineRecord", outcome: "woken" }],
      },
    },
    text: "Delivered to BaselineRecord.",
  },
);
export const agentRead = tool(
  "read",
  { path: "agent://NativeSamples" },
  {
    details: {
      totalLines: 55,
      rowPrefixes: false,
      displayContent: {
        text: "## Summary\n\n**Observed:** The plans are guidance, not live T0 evidence.",
      },
    },
    text: "## Summary\n\n**Observed:** The plans are guidance, not live T0 evidence.",
  },
);
export const localRead = tool(
  "read",
  { path: "local://frames.md:1-240" },
  {
    details: {
      totalLines: 48,
      rowPrefixes: true,
      displayContent: { text: "# Frames\n\nmodel_changed 帧带 model 对象。" },
    },
    text: "# Frames",
  },
);
export const localWrite = tool(
  "write",
  {
    path: "local://contract.md",
    content: "# Goal\n对三组样本各自独立建模匹配。",
  },
  {
    details: {
      resolvedPath: "~/.omp/agent/sessions/<session>/local/contract.md",
    },
    text: "[local://contract.md#E050]\nSuccessfully wrote 3487 bytes to local://contract.md",
  },
);
export const artifactRead = tool(
  "read",
  { path: "artifact://5:1-240" },
  {
    details: {
      totalLines: 517,
      truncation: {
        truncated: true,
        truncatedBy: "lines",
        totalLines: 517,
        outputLines: 243,
      },
      displayContent: { text: "> npm run check" },
    },
    text: "> npm run check",
  },
);
export const mcpWrite = tool(
  "write",
  { path: "xd://mcp__serena_initial_instructions", content: "{}" },
  {
    details: {
      xdev: {
        tool: "mcp__serena_initial_instructions",
        mode: "execute",
        args: {},
        inner: {
          serverName: "serena",
          mcpToolName: "initial_instructions",
          isError: false,
        },
      },
    },
    text: "<serena>\nYou have semantic coding tools…",
  },
);

export const evalCells = tool(
  "eval",
  { language: "js", title: "Isolated smoke" },
  {
    details: {
      language: "js",
      languages: ["js"],
      cells: [
        {
          index: 0,
          title: "Preparing runtime",
          code: "var fs = await import('node:fs/promises');",
          language: "js",
          output: "ok",
        },
        {
          index: 1,
          title: "Run shutdown scenarios",
          code: "await run();",
          language: "js",
          output: "3 passed",
        },
        {
          index: 2,
          title: "Close baseline runtime",
          code: "await baseline.close();",
          language: "js",
          output:
            "ToolError: Browser code execution hung past grace; tab killed",
          isError: true,
        },
      ],
    },
    text: "ToolError: Browser code execution hung past grace; tab killed",
    isError: true,
  },
);
export const askAnswered = tool(
  "ask",
  { question: "两个数值使用哪种含义？" },
  {
    details: {
      question: "两个数值使用哪种含义？",
      options: ["实际距离、像素距离", "像素距离、整数像素数"],
      multi: false,
      selectedOptions: ["实际距离、像素距离"],
    },
    text: "实际距离、像素距离",
  },
);
export const webSearch = tool(
  "web_search",
  { query: "omp changelog" },
  {
    details: {
      response: {
        provider: "parallel",
        sources: [
          {
            title: "OMP Changelog (Oktober 2026)",
            url: "https://example.com/changelog",
            snippet: "Fixed the native addon keeping every test…",
          },
          {
            title: "oh-my-pi v18.3.4 release",
            url: "https://github.com/can1357/oh-my-pi/releases/tag/v18.3.4",
            snippet: "Added rpc-ui mode…",
          },
        ],
      },
    },
    text: "",
  },
);
export const taskProgress = tool(
  "task",
  { tasks: [] },
  {
    details: {
      results: [],
      totalDurationMs: 252000,
      progress: [
        {
          index: 0,
          id: "PerfCore",
          agent: "task",
          status: "completed",
          task: "Own package.json dev script",
        },
        {
          index: 1,
          id: "LiveData",
          agent: "task",
          status: "running",
          task: "Capture live frames",
        },
        {
          index: 2,
          id: "ReleaseDocs",
          agent: "task",
          status: "pending",
          task: "Update CHANGELOG",
        },
      ],
    },
    text: "",
  },
);
export const waitJobs = tool(
  "wait",
  {},
  {
    details: {
      op: "wait",
      jobs: [
        {
          id: "bg_3",
          type: "bash",
          status: "completed",
          label: "python archive.py",
          durationMs: 310786,
        },
        {
          id: "bg_4",
          type: "bash",
          status: "completed",
          label: "npm run build",
          durationMs: 62000,
        },
      ],
    },
    text: "## Completed (2)",
  },
);
export const yieldResult = tool(
  "yield",
  { data: { files: ["smoke/main.cpp"], implementation: "…" } },
  {
    details: {
      status: "submitted",
      data: { files: ["smoke/main.cpp"], implementation: "…" },
    },
    text: "Result submitted.",
  },
);

export const ircIncoming: AgentMessage = {
  role: "custom",
  customType: "irc:incoming",
  display: true,
  content:
    "<irc>\nIncoming IRC message from agent `LiveData`:\n\nmodel_changed 帧带 model 对象（provider、id），样本已写入 local://frames.md。\n</irc>",
  details: {
    id: "15bf6baceab03728",
    from: "LiveData",
    message:
      "model_changed 帧带 model 对象（provider、id），样本已写入 local://frames.md。",
  },
  timestamp: 1793693433522,
};
export const launchCompletion: AgentMessage = {
  role: "custom",
  customType: "launch-completion",
  display: true,
  content: "Supervised process PrePerfPortableSmoke exited with exit code 0.",
  details: {
    daemons: [
      {
        name: "PrePerfPortableSmoke",
        state: "exited",
        startedAt: 1793607220514,
        exitedAt: 1793607273199,
        exitCode: 0,
      },
    ],
  },
  timestamp: 1793607280226,
};
export const handoff: AgentMessage = {
  role: "custom",
  customType: "handoff",
  display: true,
  content: "<handoff-context>\n## Goal\n交付启动器脚本。\n</handoff-context>",
  timestamp: 1793607280226,
};
