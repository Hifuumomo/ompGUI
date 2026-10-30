import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NativeModelAction,
  NativeModelHubProps,
  NativeModelSnapshot,
} from "../../shared/native-model";
import { INITIAL_HUB_STATE, type HubState } from "./model-hub-state";

function initialState(props: NativeModelHubProps): HubState {
  const selected = props.temporary
    ? props.snapshot.models.filter((model) => model.kind === "chat").findIndex(
        (model) => model.selector === props.snapshot.currentSelector,
      )
    : 0;
  return {
    ...INITIAL_HUB_STATE,
    kind: props.temporary ? "chat" : INITIAL_HUB_STATE.kind,
    query: props.snapshot.query,
    index: Math.max(0, selected),
  };
}

function useNativeRequest(
  props: NativeModelHubProps,
  setData: (data: NativeModelSnapshot) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const applying = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const run = useCallback(
    (
      action: NativeModelAction,
      done?: (snapshot: NativeModelSnapshot) => void,
    ) => {
      const searching = action.op === "search";
      if (applying.current) return;
      const request = ++sequence.current;
      if (!searching) {
        applying.current = true;
        setBusy(true);
      }
      setError("");
      void latest.current
        .onAction(action)
        .then((snapshot) => {
          if (request !== sequence.current) return;
          setData(snapshot);
          done?.(snapshot);
        })
        .catch((failure) => {
          if (request === sequence.current)
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
        })
        .finally(() => {
          if (!searching) applying.current = false;
          if (request === sequence.current) setBusy(false);
        });
    },
    [],
  );
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  return { run, busy, error };
}

/** Keep native results authoritative, including error visibility and stale search responses. */
export function useModelHub(props: NativeModelHubProps) {
  const [data, setData] = useState(props.snapshot);
  const [state, setState] = useState(() => initialState(props));
  const request = useNativeRequest(props, setData);
  const patch = useCallback(
    (change: Partial<HubState>) =>
      setState((previous) => ({ ...previous, ...change })),
    [],
  );
  useEffect(() => {
    setData(props.snapshot);
  }, [props.snapshot]);
  useEffect(() => {
    if (
      !request.busy &&
      state.query !== data.query &&
      !(props.temporary && !state.task && state.query.startsWith("@"))
    )
      request.run({ op: "search", query: state.query });
  }, [state.query, state.task, data.query, props.temporary, request.run, request.busy]);
  return { data, state, patch, ...request };
}
