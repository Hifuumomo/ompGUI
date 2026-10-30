import { useEffect, useState } from "react";
import type { SubagentTransport } from "../../shared/subagents";
import {
  EMPTY_SUBAGENTS,
  mergeSubagent,
  type SubagentState,
} from "./subagent-state";

export function useSubagentHistory(options: {
  readonly transport: SubagentTransport;
  readonly sessionId?: string;
  readonly enabled: boolean;
}) {
  const { transport, sessionId, enabled } = options;
  const [state, setState] = useState(EMPTY_SUBAGENTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let disposed = false;
    setLoading(true);
    setError("");
    async function load() {
      const result = await transport.subagentHistory({
        op: "list",
        sessionId: sessionId!,
      });
      if (!disposed)
        setState(result.subagents.reduce(mergeSubagent, EMPTY_SUBAGENTS));
    }
    void load()
      .catch((failure) => {
        if (!disposed) setError(String(failure));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [transport, sessionId, enabled, revision]);
  return {
    ...state,
    loading,
    error,
    refresh: () => setRevision((value) => value + 1),
  };
}

/** Live records take precedence over parked disk records, including observed terminal states. */
export function combineSubagentHistory(
  history: SubagentState,
  live: SubagentState,
): SubagentState {
  const liveIds = new Set(live.agents.map((agent) => agent.id));
  return {
    agents: [
      ...history.agents.filter((agent) => !liveIds.has(agent.id)),
      ...live.agents,
    ],
    activity: [
      ...history.activity.filter((row) => !liveIds.has(row.agentId)),
      ...live.activity,
    ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
  };
}
