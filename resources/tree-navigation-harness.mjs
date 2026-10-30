import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerTreeNavigation } from "./tree-navigation.mjs";

function createContext(options, calls, events) {
  const selections = [...(options.selections ?? [])];
  const inputs = [...(options.inputs ?? [])];
  const summaryAbort = new AbortController();
  const ctx = {
    agent: { kind: "main", id: "Main" },
    summaryAbort,
    model: { id: "test", provider: "test" },
    sessionManager: {
      getSessionId: () => "session",
      appendLabelChange: (...args) => calls.push(["label", ...args]),
      flush: async () => calls.push(["flush"]),
    },
    modelRegistry: {
      getApiKey: async () => "test-only",
      resolver: () => () => "test-only",
    },
    ui: {
      select: async (...args) => {
        calls.push(["select", ...args]);
        return selections.shift();
      },
      input: async (...args) => {
        calls.push(["input", ...args]);
        return inputs.shift();
      },
    },
    navigateTree: async (entryId, settings) => {
      calls.push(["navigate", entryId, settings]);
      const result = await events.get("session_before_tree")(
        {
          signal: summaryAbort.signal,
          preparation: {
            targetId: entryId,
            userWantsSummary: settings.summarize,
            entriesToSummarize: [{ id: "source" }],
          },
        },
        ctx,
      );
      calls.push(["hook", result]);
      if (result?.cancel) return { cancelled: true };
      if (settings.summarize && !result?.summary)
        calls.push(["default-summary"]);
      return { cancelled: false };
    },
  };
  return ctx;
}

function createModules(options, calls) {
  return {
    AsyncLocalStorage,
    contextSettings: {
      cfgBranchSummaryEnabled: { get: () => options.enabled ?? true },
      cfgBranchSummaryReserveTokens: { get: () => 16384 },
    },
    compaction: {
      generateBranchSummary: async (...args) => {
        calls.push(["generate", ...args]);
        if (options.generate) return options.generate(...args);
        if (options.failure) throw options.failure;
        return options.summaryResult ?? { summary: "实际生成器的契约样本" };
      },
    },
    secretTransforms: {
      obfuscateMessages: (obfuscator, messages) =>
        messages.map((message) => ({
          ...message,
          content: obfuscator.obfuscate(message.content),
        })),
    },
  };
}

export function fixture(options = {}) {
  const events = new Map();
  const calls = [];
  const replies = [];
  const ctx = createContext(options, calls, events);
  const modules = createModules(options, calls);
  const session = {
    sessionManager: ctx.sessionManager,
    sessionId: "provider-session",
    model: ctx.model,
    settings: {},
    obfuscator: options.obfuscator,
    agent: { metadataForProvider: () => ({ native: true }) },
    abortBranchSummary: () => {
      calls.push(["abort"]);
      ctx.summaryAbort.abort();
    },
  };
  let command;
  const api = {
    pi: {
      settings: {},
      convertToLlm: (messages) => messages,
      AgentRegistry: { global: () => ({ get: () => ({ session }) }) },
    },
    on: (name, handler) => events.set(name, handler),
    registerCommand: (_name, value) => {
      command = value.handler;
    },
  };
  registerTreeNavigation(
    api,
    (_ctx, id, reply) => replies.push({ id, ...reply }),
    async () => {
      await options.loading;
      return modules;
    },
  );
  return {
    calls,
    replies,
    run: async (request = {}) => {
      await command(
        JSON.stringify({ requestId: "test", entryId: "target", ...request }),
        ctx,
      );
      return replies.at(-1);
    },
  };
}
