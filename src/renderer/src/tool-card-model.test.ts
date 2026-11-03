// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  patchMoves,
  describeToolCall,
  toolOperation,
} from "../../shared/tool-presentation";
import type { AgentMessage } from "../../shared/protocol";
import type { ProcessItem, ToolEvidence } from "./transcript-types";
import { transcriptUnits } from "./transcript-model";
import {
  cardKind,
  cardStatus,
  groupCardItems,
  toolDetails,
  toolDurationMs,
  toolResultText,
  virtualScheme,
} from "./tool-card-model";

/** 构造保留原始结果结构的纯测试证据。 */
function tool(
  name: string,
  args: unknown = {},
  details?: unknown,
): ToolEvidence {
  return {
    id: name,
    name,
    args,
    resultMessage:
      details === undefined ? undefined : { role: "toolResult", details },
  };
}

it.each([
  ["read", "readonly"],
  ["functions.read_file", "readonly"],
  ["grep", "readonly"],
  ["glob", "readonly"],
  ["edit", "edit"],
  ["write", "write"],
  ["pwsh", "bash"],
  ["web_search", "search"],
  ["functions.eval", "eval"],
  ["functions.wait", "wait"],
  ["task", "task"],
  ["ask", "ask"],
  ["yield", "yield"],
  ["other", "generic"],
])("routes %s to %s", (name, expected) =>
  expect(cardKind(tool(name))).toBe(expected),
);

it("prioritizes validation, deletion, virtual resources, inbox, and service routing", () => {
  expect(
    cardKind(
      tool(
        "edit",
        {},
        { op: "delete", isError: true, error: "Validation failed for tool" },
      ),
    ),
  ).toBe("invalid");
  expect(
    cardKind(tool("edit", { path: "agent://Main" }, { op: "delete" })),
  ).toBe("delete");
  for (const [name, path, expected] of [
    ["write", "agent://Main", "message-out"],
    ["read", "AGENT://Main", "agent-output"],
    ["write", "xd://tool", "mcp"],
    ["read", "proc://job", "process"],
    ["write", "proc://job/kill", "process"],
    ["read", "xd://tool", "readonly"],
    ["write", "local://note.md", "write"],
  ])
    expect(cardKind(tool(name, JSON.stringify({ path })))).toBe(expected);
  expect(cardKind(tool("hub", { op: "inbox" }, { op: "list" }))).toBe(
    "message-in",
  );
  expect(cardKind(tool("hub", {}, { op: "inbox" }))).toBe("message-in");
  expect(cardKind(tool("hub", { op: "start" }))).toBe("process");
  expect(cardKind(tool("bash", {}, { service: {} }))).toBe("process");
  expect(cardKind(tool("bash", {}, { async: { state: "running" } }))).toBe(
    "bash",
  );
  expect(
    cardKind(
      tool(
        "hub",
        {},
        { isError: true, error: "Validation failed: missing op" },
      ),
    ),
  ).toBe("invalid");
});

it("recognizes only listed virtual schemes without granting file targets", () => {
  for (const scheme of [
    "local",
    "agent",
    "xd",
    "proc",
    "artifact",
    "history",
    "http",
    "https",
    "omp",
    "cfg",
    "ssh",
    "attachment",
  ]) {
    expect(virtualScheme(`${scheme.toUpperCase()}://resource`)).toBe(scheme);
  }
  for (const path of ["file://a", "C:/file", "other://a", " local://a"])
    expect(virtualScheme(path)).toBeUndefined();
  for (const path of [
    "agent://Main",
    "xd://tool",
    "proc://job",
    "local://note.md",
  ]) {
    expect(describeToolCall("read", { path }).targets[0].kind).toBe("query");
  }
  expect(toolOperation("mcp__server_read_file")).toBe("read");
});

it("extracts moves from both patch formats without interpreting inserted fake headers", () => {
  expect(
    patchMoves(
      '*** Begin Patch\n[a.md#ABCD]\nMV "dir/b.md"\n*** Update File: old.ts\n*** Move to: new.ts\n*** Add File: add.ts\n+*** Move to: fake.ts\n*** End Patch\n',
    ),
  ).toEqual([
    { from: "a.md", to: "dir/b.md" },
    { from: "old.ts", to: "new.ts" },
  ]);
  expect(patchMoves("[a.md#ABCD]\nMV b.md")).toEqual([]);
});

it("uses each duration source in strict precedence and rejects invalid values", () => {
  const evidence: ToolEvidence = {
    ...tool("bash", {}, { wallTimeMs: 4, totalDurationMs: 8 }),
    startedAt: 100,
    resultMessage: {
      role: "toolResult",
      timestamp: 130,
      details: { wallTimeMs: 4, totalDurationMs: 8 },
    },
    live: {
      id: "bash",
      name: "bash",
      args: {},
      running: true,
      startedAt: 10,
      endedAt: 60,
    },
  };
  expect(toolDurationMs(evidence, 1000)).toBe(4);
  evidence.resultMessage!.details = { wallTimeMs: NaN, totalDurationMs: 8 };
  expect(toolDurationMs(evidence, 1000)).toBe(8);
  evidence.resultMessage!.details = { wallTimeMs: -1 };
  expect(toolDurationMs(evidence, 1000)).toBe(30);
  delete evidence.resultMessage;
  expect(toolDurationMs(evidence, 1000)).toBe(50);
  delete evidence.live!.endedAt;
  expect(toolDurationMs(evidence, 1000)).toBe(990);
  evidence.live!.running = false;
  expect(toolDurationMs(evidence, 1000)).toBeUndefined();
  expect(toolDurationMs(tool("bash"), 1000)).toBeUndefined();
  evidence.resultMessage = { role: "toolResult", timestamp: 50 };
  expect(toolDurationMs(evidence, 1000)).toBe(0);
});

it("does not keep timing after an authoritative result supersedes stale running activity", () => {
  const evidence: ToolEvidence = {
    ...tool("bash", {}, {}),
    live: { id: "bash", name: "bash", args: {}, running: true, startedAt: 10 },
  };
  expect(toolDurationMs(evidence, 1000)).toBeUndefined();
  expect(toolDurationMs(evidence, 2000)).toBeUndefined();
});

it("defensively reads details and text with historical precedence", () => {
  const evidence = tool("read", {}, { totalLines: 2 });
  evidence.live = {
    id: "read",
    name: "read",
    args: {},
    running: true,
    error: true,
    result: { details: { stale: true }, content: "stale" },
  };
  evidence.resultMessage!.content = [
    { type: "text", text: "a" },
    { type: "image", data: "image" },
    { type: "text", text: "b" },
  ];
  expect(toolDetails(evidence)).toEqual({ totalLines: 2 });
  expect(toolResultText(evidence)).toBe("a\nb");
  expect(cardStatus(evidence)).toBe("ok");
  delete evidence.resultMessage;
  expect(toolResultText(evidence)).toBe("stale");
  expect(toolDetails(tool("read", {}, []))).toEqual({});
  expect(toolResultText(tool("read"))).toBe("");
  expect(
    toolResultText({
      ...tool("bash"),
      resultMessage: { role: "bashExecution", output: "stdout" },
    }),
  ).toBe("stdout");
});

it("handles cancellation before errors and preserves unknown and streaming states", () => {
  expect(
    cardStatus({
      ...tool("bash"),
      resultMessage: { role: "toolResult", cancelled: true, isError: true },
    }),
  ).toBe("cancelled");
  expect(cardStatus(tool("eval", {}, { status: "error", exitCode: 1 }))).toBe(
    "error",
  );
  expect(
    cardStatus({
      ...tool("bash"),
      resultMessage: { role: "bashExecution", exitCode: 2 },
    }),
  ).toBe("error");
  expect(cardStatus(tool("read"))).toBe("unknown");
  expect(
    cardStatus({ ...tool("write"), streamingArgs: { content: "partial" } }),
  ).toBe("running");
  expect(
    cardStatus({
      ...tool("bash"),
      live: { id: "bash", name: "bash", args: {}, running: true },
    }),
  ).toBe("running");
});

it("groups readonly and errors without crossing thinking, messages, or ordinary tools", () => {
  const items: ProcessItem[] = [
    { kind: "tool", key: "a", tool: tool("read") },
    { kind: "tool", key: "b", tool: tool("grep", {}, { isError: true }) },
    {
      kind: "thinking",
      key: "think",
      part: { type: "thinking", thinking: "think" },
      streaming: false,
    },
    { kind: "tool", key: "c", tool: tool("glob") },
    { kind: "tool", key: "d", tool: tool("write") },
    { kind: "tool", key: "e", tool: tool("edit") },
    {
      kind: "message",
      key: "error1",
      message: { role: "assistant", errorMessage: "error", content: [] },
      streaming: false,
    },
    {
      kind: "message",
      key: "error2",
      message: { role: "assistant", stopReason: "error", content: "" },
      streaming: false,
    },
    {
      kind: "message",
      key: "normal",
      message: {
        role: "assistant",
        content: "normal",
        errorMessage: "not pure",
      },
      streaming: false,
    },
    { kind: "tool", key: "f", tool: tool("read") },
  ];
  const before = structuredClone(items);
  const grouped = groupCardItems(Object.freeze(items));
  expect(grouped.map((entry) => entry.kind)).toEqual([
    "readonly",
    "thinking",
    "readonly",
    "tool",
    "tool",
    "errors",
    "message",
    "readonly",
  ]);
  expect(grouped[0]).toMatchObject({
    key: "a",
    items: [{ key: "a" }, { key: "b" }],
  });
  expect(grouped[5]).toMatchObject({
    key: "error1",
    items: [{ key: "error1" }, { key: "error2" }],
  });
  expect(items).toEqual(before);
});

describe("transcript full projection", () => {
  it("reads hidden start metadata without producing a timeline item", () => {
    const messages: AgentMessage[] = [
      {
        role: "custom",
        customType: "tool_execution_start",
        display: false,
        details: { toolCallId: "call", startedAt: "2026-11-03T00:00:00.000Z" },
      },
      {
        role: "toolResult",
        toolCallId: "call",
        toolName: "read",
        content: "done",
      },
    ];
    const units = transcriptUnits(
      messages.map((message, index) => ({
        key: String(index),
        message,
        streaming: false,
      })),
      [],
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      kind: "process",
      items: [
        {
          kind: "tool",
          tool: {
            id: "call",
            startedAt: Date.parse("2026-11-03T00:00:00.000Z"),
          },
        },
      ],
    });
  });
  it("shows eval/wait only in full, hides todo, and converts native bash only in full", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: ["eval", "wait", "todo"].map((name) => ({
          type: "toolCall",
          id: name,
          name,
          arguments: {},
        })),
      },
      { role: "bashExecution", command: "pwd", output: "cwd", exitCode: 0 },
    ];
    const timeline = messages.map((message, index) => ({
      key: String(index),
      message,
      streaming: false,
    }));
    expect(transcriptUnits(timeline, [])).toMatchObject([
      { kind: "message", message: { role: "bashExecution" } },
    ]);
    expect(transcriptUnits(timeline, [], "full")).toMatchObject([
      {
        kind: "process",
        items: [
          { kind: "tool", tool: { name: "eval" } },
          { kind: "tool", tool: { name: "wait" } },
          {
            kind: "tool",
            tool: {
              id: "1",
              name: "bash",
              args: { command: "pwd" },
              resultMessage: { output: "cwd" },
            },
          },
        ],
      },
    ]);
  });
});
