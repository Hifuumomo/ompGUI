import type {
  SubagentSnapshot,
  SubagentActivityRow,
} from "../../shared/subagents";
import { SUBAGENT_LABELS, subagentParent } from "./subagent-state";

/** 用状态灯表达代理状态，同时保留可访问名称和悬停说明。
 * @param agent [in] 需要展示状态的代理快照。
 * @returns 带状态名称的彩色指示灯。
 */
export function SubagentStatus({
  agent,
}: {
  readonly agent: SubagentSnapshot;
}) {
  return (
    <span
      className={`subagent-status ${agent.status}`}
      role="img"
      aria-label={SUBAGENT_LABELS[agent.status]}
      title={SUBAGENT_LABELS[agent.status]}
    />
  );
}

interface RosterProps {
  readonly agents: readonly SubagentSnapshot[];
  readonly selected?: string;
  readonly grouped: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
}
export function SubagentRoster(props: RosterProps) {
  const agents = props.grouped
    ? [...props.agents].sort((a, b) =>
        subagentParent(a).localeCompare(subagentParent(b)),
      )
    : props.agents;
  return (
    <div className="subagent-roster" role="listbox" aria-label="子代理列表">
      {agents.map((agent, index) => (
        <div key={agent.id}>
          {props.grouped &&
            (index === 0 ||
              subagentParent(agents[index - 1]) !== subagentParent(agent)) && (
              <h3 className="subagent-group">父级 {subagentParent(agent)}</h3>
            )}
          <button
            role="option"
            aria-selected={props.selected === agent.id}
            onClick={() => props.onSelect(agent.id)}
            onDoubleClick={() => props.onOpen(agent.id)}
          >
            <div>
              <strong>{agent.agent}</strong>
              <SubagentStatus agent={agent} />
            </div>
            <small>{agent.id}</small>
            <p>{agent.task ?? agent.description ?? "等待进度…"}</p>
            <small>
              {agent.progress?.currentTool ??
                agent.progress?.resolvedModel ??
                agent.agentSource}
            </small>
          </button>
        </div>
      ))}
      {!agents.length && (
        <p className="subagent-empty">
          没有符合条件的子代理。当前连接的 omp 启动子代理后会实时显示。
        </p>
      )}
    </div>
  );
}

export function SubagentTimeline(props: {
  readonly rows: readonly SubagentActivityRow[];
  readonly selected?: string;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <div className="subagent-timeline" role="listbox" aria-label="活动时间线">
      {props.rows.map((row) => (
        <button
          key={row.id}
          role="option"
          aria-selected={row.id === props.selected}
          className={row.error ? "subagent-error" : ""}
          onClick={() => props.onSelect(row.id)}
          onDoubleClick={() => props.onOpen(row.agentId)}
        >
          <time>{new Date(row.time).toLocaleTimeString()}</time>
          <code>{row.agentId}</code>
          <strong>{row.title}</strong>
          <pre>{row.text}</pre>
        </button>
      ))}
      {!props.rows.length && (
        <p className="subagent-empty">暂无符合筛选条件的活动。</p>
      )}
    </div>
  );
}
