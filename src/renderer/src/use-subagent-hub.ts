import { useEffect, useState } from "react";
import type { SubagentHubProps as Props } from "./subagent-hub-controls";
import { useSubagents } from "./use-subagents";
import {
  useSubagentHistory,
  combineSubagentHistory,
} from "./use-subagent-history";
import {
  SUBAGENT_FILTERS,
  subagentParent,
  type SubagentFilter,
} from "./subagent-state";
const FILTERS = Object.keys(SUBAGENT_FILTERS) as SubagentFilter[];
export function useHubState(props: Props) {
  const [started, setStarted] = useState(props.open);
  useEffect(() => {
    if (props.open) setStarted(true);
  }, [props.open]);
  const live = useSubagents(props.transport, started && props.connected);
  const history = useSubagentHistory({
    transport: props.transport,
    sessionId: props.sessionId,
    enabled: started,
  });
  const data = {
    ...combineSubagentHistory(history, live),
    loading: live.loading || history.loading,
    error: [history.error, live.error].filter(Boolean).join("\n"),
    refresh: () => {
      history.refresh();
      live.refresh();
    },
  };
  const controls = useHubControls();
  return { data, ...controls, ...projectHub(data, controls) };
}
function useHubControls() {
  const [tab, setTab] = useState<"agents" | "activity">("agents");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [activityId, setActivityId] = useState<string>();
  const [transcriptId, setTranscriptId] = useState<string>();
  const [grouped, setGrouped] = useState(false);
  const [filter, setFilter] = useState<SubagentFilter>("all");
  const [scope, setScope] = useState(false);
  const [follow, setFollow] = useState(true);
  return {
    tab,
    setTab,
    query,
    setQuery,
    selected,
    setSelected,
    activityId,
    setActivityId,
    transcriptId,
    setTranscriptId,
    grouped,
    setGrouped,
    filter,
    setFilter,
    scope,
    setScope,
    follow,
    setFollow,
  };
}
function projectHub(
  data: ReturnType<typeof useSubagents>,
  controls: ReturnType<typeof useHubControls>,
) {
  const {
    query,
    grouped,
    selected,
    scope,
    filter,
    follow,
    activityId,
    transcriptId,
  } = controls;
  const search = query.toLocaleLowerCase();
  const agents = data.agents.filter((agent) =>
    [agent.id, agent.agent, agent.task, agent.description].some((text) =>
      text?.toLocaleLowerCase().includes(search),
    ),
  );
  const ordered = grouped
    ? [...agents].sort((a, b) =>
        subagentParent(a).localeCompare(subagentParent(b)),
      )
    : agents;
  const candidates = controls.tab === "agents" ? ordered : data.agents;
  const agent =
    candidates.find((item) => item.id === selected) ?? candidates[0];
  const rows = data.activity
    .filter(
      (row) =>
        (!scope || row.agentId === agent?.id) &&
        `${row.agentId} ${row.title} ${row.text}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .filter(
      (row) =>
        filter === "all" ||
        (filter === "errors" ? row.error : row.kind === filter),
    );
  const row = follow
    ? rows.at(-1)
    : (rows.find((item) => item.id === activityId) ?? rows[0]);
  const transcript = data.agents.find((item) => item.id === transcriptId);
  return { agents: ordered, agent, rows, row, transcript };
}
export type HubState = ReturnType<typeof useHubState>;

export function hubActions(state: HubState, close: () => void) {
  const back = () => {
    if (state.transcript) state.setTranscriptId(undefined);
    else if (state.query) state.setQuery("");
    else close();
  };
  const enter = () =>
    state.setTranscriptId(
      state.tab === "agents" ? state.agent?.id : state.row?.agentId,
    );
  const move = (delta: number) => {
    if (state.transcript) return;
    const items = state.tab === "agents" ? state.agents : state.rows;
    const id = state.tab === "agents" ? state.agent?.id : state.row?.id;
    const index = items.findIndex((item) => item.id === id);
    const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
    if (state.tab === "agents") state.setSelected(next?.id);
    else {
      state.setFollow(false);
      state.setActivityId(next?.id);
    }
  };
  return {
    back,
    enter,
    move,
    tab: state.setTab,
    group: () => state.setGrouped((value) => !value),
    filter: () =>
      state.setFilter(
        (value) => FILTERS[(FILTERS.indexOf(value) + 1) % FILTERS.length],
      ),
    scope: () => state.setScope((value) => !value),
    follow: () => state.setFollow((value) => !value),
  };
}
