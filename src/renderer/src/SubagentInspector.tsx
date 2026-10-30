import type {
  SubagentSnapshot,
  SubagentProgress,
  SubagentActivityRow,
} from "../../shared/subagents";
import { SUBAGENT_LABELS, subagentParent } from "./subagent-state";
import { SubagentStatus } from "./subagent-views";
const MILLISECONDS_PER_SECOND = 1000;
const COST_DECIMALS = 4;

/** 展示代理身份、来源和任务。
 * @param agent [in] 当前选中的代理快照。
 * @returns 身份信息与 Task 区域。
 */
function AgentFacts({ agent }: { readonly agent: SubagentSnapshot }) {
  return (
    <>
      <header>
        <div>
          <h2>{agent.agent} <small>#{agent.index}</small></h2>
          <code>{agent.id}</code>
        </div>
        <SubagentStatus agent={agent} />
      </header>
      <p>{agent.description}</p>
      <dl className="subagent-facts">
        <dt>模型</dt>
        <dd>
          {agent.progress?.resolvedModel ?? "尚未报告"}
          {agent.progress?.modelRole && " · " + agent.progress.modelRole}
        </dd>
        <dt>来源</dt>
        <dd>{agent.historical ? "历史记录" : agent.agentSource}</dd>
        <dt>父代理 / 任务</dt>
        <dd>{subagentParent(agent)}</dd>
        <dt>最近更新</dt>
        <dd>{new Date(agent.lastUpdate).toLocaleTimeString()}</dd>
      </dl>
      <h3>Task</h3>
      <p className="subagent-pre">
        {agent.assignment ?? agent.task ?? "等待任务信息…"}
      </p>
    </>
  );
}

/** 用独立配色的椭圆标签展示原生用量。
 * @param progress [in] 原生进度与用量数据。
 * @returns 用量标签及可用的上下文窗口信息。
 */
function AgentMetrics({ progress }: { readonly progress: SubagentProgress }) {
  const metrics = [
    ["tokens", progress.tokens.toLocaleString(), "tokens"],
    ["requests", progress.requests, "请求"],
    ["tools", progress.toolCount, "工具"],
    ["cost", "$" + progress.cost.toFixed(COST_DECIMALS), "费用"],
    [
      "duration",
      (progress.durationMs / MILLISECONDS_PER_SECOND).toFixed(1) + "s",
      progress.durationKind === "span" ? "对话跨度" : "运行时间",
    ],
  ];
  return (
    <>
      <div className="subagent-metrics">
        {metrics.map(([kind, value, label]) => (
          <span key={kind} className={`subagent-metric-${kind}`}>
            <b>{value}</b>{label}
          </span>
        ))}
      </div>
      {progress.contextWindow !== undefined && (
        <p>上下文 {progress.contextTokens ?? 0} / {progress.contextWindow}</p>
      )}
    </>
  );
}

/** 展示选中代理的带时间活动记录，不受全局搜索或类型筛选影响。
 * @param agent [in] 选中代理，用于按 agentId 隔离记录。
 * @param activity [in] 当前会话的完整活动记录。
 * @returns 可独立滚动的近期活动区域。
 */
function AgentRecent({ agent, activity }: {
  readonly agent: SubagentSnapshot;
  readonly activity: readonly SubagentActivityRow[];
}) {
  // 使用完整活动源，避免其他代理或 Activity 页筛选污染详情。
  const rows = activity.filter((row) => row.agentId === agent.id);
  return (
    <>
      <h3>Recent activity</h3>
      <div className="subagent-recent" role="region" aria-label="代理近期活动" tabIndex={0}>
        <ul>
          {rows.map((row) => (
            <li key={row.id} className={row.error ? "subagent-error" : ""}>
              <time dateTime={new Date(row.time).toISOString()}>
                {new Date(row.time).toLocaleTimeString()}
              </time>
              <div><strong>{row.title}</strong><p>{row.text}</p></div>
            </li>
          ))}
        </ul>
        {!rows.length && <p className="subagent-note">暂无活动。</p>}
      </div>
    </>
  );
}

/** 按 Task、Current、Output、Usage、Recent activity 展示代理详情。
 * @param agent [in] 当前选中的代理，未选择时显示提示。
 * @param activity [in] 当前会话的完整活动记录。
 * @param onTranscript [in] 打开选中代理原生对话的回调。
 * @returns 代理详情侧栏。
 */
export function SubagentInspector({ agent, activity, onTranscript }: {
  readonly agent?: SubagentSnapshot;
  readonly activity: readonly SubagentActivityRow[];
  readonly onTranscript: () => void;
}) {
  if (!agent)
    return <aside className="subagent-inspector"><p>选择代理查看活动详情。</p></aside>;
  const progress = agent.progress;
  const current = agent.status === "running" ? progress?.currentTool : undefined;
  return (
    <aside className="subagent-inspector" aria-label="代理详情">
      <AgentFacts agent={agent} />
      <h3>Current</h3>
      <p>{current ?? SUBAGENT_LABELS[agent.status]}</p>
      {current && <pre>{progress?.currentToolIntent ?? JSON.stringify(progress?.currentToolArgs ?? {}, null, 2)}</pre>}
      <h3>Output</h3>
      <pre>{progress?.recentOutput.join("\n") || (agent.historical ? "历史输出保存在对话中。" : "等待输出…")}</pre>
      <h3>Usage</h3>
      {progress ? <AgentMetrics progress={progress} /> : <p>尚未报告用量。</p>}
      <AgentRecent agent={agent} activity={activity} />
      <button onClick={onTranscript}>查看对话 ↵</button>
    </aside>
  );
}
