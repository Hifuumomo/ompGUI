import { SubagentInspector } from "./SubagentInspector";
import type { SubagentTransport } from "../../shared/subagents";
import type { HubState } from "./use-subagent-hub";
import { SubagentRoster, SubagentTimeline } from "./subagent-views";
import { SubagentTranscript } from "./SubagentTranscript";
export interface SubagentHubProps {
  readonly sessionId?: string;
  readonly transport: SubagentTransport;
  readonly open: boolean;
  readonly connected: boolean;
  readonly onClose: () => void;
}
import { SUBAGENT_FILTERS, type SubagentFilter } from "./subagent-state";
export function HubToolbar({ state }: { readonly state: HubState }) {
  return (
    <>
      {state.tab === "agents" ? (
        <button onClick={() => state.setGrouped(!state.grouped)}>
          {state.grouped ? "按父级分组" : "平铺列表"} · T
        </button>
      ) : (
        <>
          <select
            aria-label="活动类型"
            value={state.filter}
            onChange={(event) =>
              state.setFilter(event.target.value as SubagentFilter)
            }
          >
            {Object.entries(SUBAGENT_FILTERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label} · F
              </option>
            ))}
          </select>
          <button onClick={() => state.setScope(!state.scope)}>
            {state.scope ? `代理 ${state.agent?.id ?? "未选择"}` : "全部代理"} ·
            S
          </button>
          <button
            aria-pressed={state.follow}
            onClick={() => state.setFollow(!state.follow)}
          >
            {state.follow ? "跟随最新" : "暂停跟随"} · Space
          </button>
        </>
      )}
      <button onClick={state.data.refresh} disabled={state.data.loading}>
        刷新
      </button>
    </>
  );
}

/** 展示当前页签的列表、代理详情或原生对话。
 * @param state [in] Hub 状态及完整会话活动数据。
 * @param transport [in] 原生子代理通信接口。
 * @param sessionId [in] 当前会话标识。
 * @returns 当前页签内容。
 */
export function HubBody({
  state,
  transport,
  sessionId,
}: {
  readonly state: HubState;
  readonly transport: SubagentTransport;
  readonly sessionId?: string;
}) {
  if (state.transcript)
    return (
      <SubagentTranscript
        key={state.transcript.id}
        agent={state.transcript}
        transport={transport}
        sessionId={sessionId}
      />
    );
  if (state.tab === "activity")
    return (
      <SubagentTimeline
        rows={state.rows}
        selected={state.row?.id}
        onSelect={(id) => {
          state.setFollow(false);
          state.setActivityId(id);
        }}
        onOpen={state.setTranscriptId}
      />
    );
  return (
    <div className="subagent-columns">
      <SubagentRoster
        agents={state.agents}
        selected={state.agent?.id}
        grouped={state.grouped}
        onSelect={state.setSelected}
        onOpen={state.setTranscriptId}
      />
      <SubagentInspector
        agent={state.agent}
        activity={state.data.activity}
        onTranscript={() => state.setTranscriptId(state.agent?.id)}
      />
    </div>
  );
}

export function HubConnection({
  state,
  props,
}: {
  readonly state: HubState;
  readonly props: SubagentHubProps;
}) {
  if (!props.connected && !props.sessionId)
    return <p className="subagent-empty">请先选择已有会话，或连接当前会话。</p>;
  return (
    <>
      {state.data.error && (
        <p className="subagent-error" role="alert">
          无法读取子代理活动：{state.data.error}
        </p>
      )}
      {state.data.loading && <p role="status">正在同步原生子代理…</p>}
      <HubBody
        state={state}
        transport={props.transport}
        sessionId={props.sessionId}
      />
    </>
  );
}
