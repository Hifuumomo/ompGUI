import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RpcFrame } from "../../shared/protocol";
import type {
  SubagentSnapshot,
  SubagentTransport,
} from "../../shared/subagents";
import {
  applySubagentFrame,
  EMPTY_SUBAGENTS,
  mergeSubagent,
  type SubagentState,
} from "./subagent-state";

/** Subscribe before the snapshot, then replay queued frames so completion cannot be lost. */
export function useSubagents(transport: SubagentTransport, enabled: boolean) {
  const [state, setState] = useState(EMPTY_SUBAGENTS);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    return observeSubagents(transport, { setState, setError, setLoading });
  }, [transport, enabled, revision]);
  return {
    ...state,
    loading,
    error,
    refresh: () => setRevision((value) => value + 1),
  };
}

interface ObservationHandlers {
  readonly setState: Dispatch<SetStateAction<SubagentState>>;
  readonly setError: (value: string) => void;
  readonly setLoading: (value: boolean) => void;
}
function observeSubagents(
  transport: SubagentTransport,
  handlers: ObservationHandlers,
) {
  const { setState, setError, setLoading } = handlers;
  let disposed = false;
  let ready = false;
  const buffered: RpcFrame[] = [];
  const unsubscribe = transport.onFrame((frame) => {
    if (
      frame.type !== "subagent_progress" &&
      frame.type !== "subagent_lifecycle"
    )
      return;
    if (!ready) buffered.push(frame);
    else setState((value) => applySubagentFrame(value, frame));
  });
  async function initialize() {
    await transport.request({
      type: "set_subagent_subscription",
      level: "progress",
    });
    if (disposed) return;
    const result = await transport.request<{ subagents: SubagentSnapshot[] }>({
      type: "get_subagents",
    });
    if (disposed) return;
    setState((previous) =>
      buffered.reduce(
        applySubagentFrame,
        result.subagents.reduce(mergeSubagent, previous),
      ),
    );
    ready = true;
  }
  void initialize()
    .catch((failure) => {
      unsubscribe();
      if (!disposed) setError(String(failure));
    })
    .finally(() => {
      if (!disposed) setLoading(false);
    });
  // The subscription belongs to the connected runtime; closing the view keeps tracking.
  return () => {
    disposed = true;
    unsubscribe();
  };
}
