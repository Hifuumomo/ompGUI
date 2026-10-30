import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentsAction,
  AgentsHubProps,
  AgentsSnapshot,
  AgentSpec,
} from "../../shared/native-agents";
import { INITIAL_AGENTS_STATE, type AgentsState } from "./agents-hub-state";

function useAgentsRequest(props: AgentsHubProps, query: string) {
  const [data, setData] = useState(props.snapshot);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<AgentsAction["op"]>();
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const latest = useRef(props.onAction);
  latest.current = props.onAction;
  const currentQuery = useRef(query);
  currentQuery.current = query;
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const run = useCallback(
    (action: AgentsAction, done?: (value: AgentsSnapshot) => void) => {
      const token = ++sequence.current;
      setBusy(true);
      setOperation(action.op);
      setError("");
      void latest
        .current({ ...action, query: currentQuery.current })
        .then((value) => {
          if (token !== sequence.current) return;
          setData(value);
          done?.(value);
        })
        .catch((failure) => {
          if (token === sequence.current)
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
        })
        .finally(() => {
          if (token === sequence.current) setBusy(false);
        });
    },
    [],
  );
  return { data, run, busy, error, operation };
}

function useAgentGeneration() {
  const [stream, setStream] = useState("");
  const [spec, setSpec] = useState<AgentSpec>();
  useEffect(
    () =>
      window.desktop.onFrame((frame) => {
        if (
          frame.type === "agents_hub_progress" &&
          typeof frame.text === "string"
        )
          setStream((previous) => previous + frame.text);
      }),
    [],
  );
  return { stream, setStream, spec, setSpec };
}

function useAgentsState(props: AgentsHubProps) {
  const [state, setState] = useState<AgentsState>(INITIAL_AGENTS_STATE);
  const request = useAgentsRequest(props, state.query);
  const generation = useAgentGeneration();
  const searchedQuery = useRef(props.snapshot.query);
  const patch = useCallback(
    (change: Partial<AgentsState>) =>
      setState((previous) => ({ ...previous, ...change })),
    [],
  );
  useEffect(() => {
    if (state.query === searchedQuery.current) return;
    searchedQuery.current = state.query;
    request.run({ op: "search", query: state.query });
  }, [state.query, request.run]);
  const rows = request.data.agents.filter(
    (agent) =>
      (state.scope === "all" || state.scope === agent.source) &&
      (!state.query || request.data.matches.includes(agent.name)),
  );
  const selected = rows[Math.min(state.index, rows.length)];
  return {
    ...request,
    ...generation,
    state,
    patch,
    rows,
    selected,
    close: props.onClose,
  };
}

export function useAgentsHub(props: AgentsHubProps) {
  const context = useAgentsState(props);
  const { state, patch, run, spec, setSpec, setStream } = context;
  const beginCreate = () => {
    setSpec(undefined);
    setStream("");
    patch({ stage: "create", description: "" });
  };
  const generate = () => {
    setStream("");
    setSpec(undefined);
    run({ op: "generate", description: state.description }, (result) =>
      setSpec(result.spec),
    );
  };
  const save = () => {
    if (!spec) return;
    run({ op: "save", scope: state.createScope, spec }, () => {
      setSpec(undefined);
      patch({ stage: "list", scope: state.createScope, query: "", index: 0 });
    });
  };
  return {
    ...context,
    beginCreate,
    generate,
    save,
  };
}

export type AgentsContext = ReturnType<typeof useAgentsHub>;
