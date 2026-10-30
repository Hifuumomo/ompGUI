import type { NativeAgent } from "../../shared/native-agents";
import { AGENT_SCOPES, SOURCE_LABELS, propertyValue } from "./agents-hub-state";
import type { AgentsContext } from "./use-agents-hub";

export function AgentsSidebar({ context }: { context: AgentsContext }) {
  return (
    <nav
      className={`agents-sidebar ${context.state.focus === "scope" ? "has-focus" : ""}`}
      aria-label="代理来源"
    >
      <small>代理库</small>
      {AGENT_SCOPES.map((scope) => (
        <button
          key={scope}
          aria-current={context.state.scope === scope ? "page" : undefined}
          disabled={context.busy}
          onClick={() => {
            context.patch({ scope, index: 0, stage: "list", focus: "scope" });
            if (scope === "new") context.beginCreate();
          }}
        >
          <span>{SOURCE_LABELS[scope]}</span>
          {scope !== "new" && (
            <small>
              {
                context.data.agents.filter(
                  (agent) => scope === "all" || agent.source === scope,
                ).length
              }
            </small>
          )}
        </button>
      ))}
      <p>配置沿用 omp，保存后用于后续子任务。</p>
    </nav>
  );
}

function AgentRow({
  agent,
  context,
  index,
}: {
  agent: NativeAgent;
  context: AgentsContext;
  index: number;
}) {
  const selected = context.state.index === index;
  return (
    <button
      role="option"
      aria-selected={selected}
      className={`agents-row ${agent.disabled ? "is-disabled" : ""}`}
      disabled={context.busy}
      onClick={() => context.patch({ index, stage: "agent", focus: "list" })}
    >
      <span className="agents-identity">
        <span
          className={`agents-dot ${agent.disabled ? "off" : ""}`}
          aria-label={agent.disabled ? "已禁用" : "已启用"}
        />
        <strong>{agent.name}</strong>
        <small>{agent.description}</small>
      </span>
      <span className="agents-model" title={propertyValue(agent, "model")}>
        {propertyValue(agent, "model")}
        {agent.overrideModel && <small>已覆盖</small>}
      </span>
      <span title={propertyValue(agent, "prewalk")}>
        {propertyValue(agent, "prewalk")}
      </span>
      <span title={propertyValue(agent, "advisor")}>
        {propertyValue(agent, "advisor")}
      </span>
      <span>{SOURCE_LABELS[agent.source]}</span>
    </button>
  );
}

function AgentsListHeading({ context }: { context: AgentsContext }) {
  return (
    <div className="agents-list-heading">
      <div>
        <h2>{SOURCE_LABELS[context.state.scope]}</h2>
        <span>{context.rows.length} 个代理</span>
      </div>
      <input
        aria-label="搜索代理"
        placeholder="搜索名称、用途、来源或模型…"
        value={context.state.query}
        disabled={context.busy && context.operation !== "search"}
        onChange={(event) =>
          context.patch({
            query: event.target.value,
            index: 0,
            stage: "list",
            focus: "list",
          })
        }
      />
    </div>
  );
}

export function AgentsList({ context }: { context: AgentsContext }) {
  return (
    <div
      className={`agents-list-pane ${context.state.focus === "list" ? "has-focus" : ""}`}
    >
      <AgentsListHeading context={context} />
      <div className="agents-table-scroll">
        <div className="agents-columns" aria-hidden="true">
          <span>名称与用途</span>
          <span>模型</span>
          <span>Prewalk</span>
          <span>Advisor</span>
          <span>来源</span>
        </div>
        <div role="listbox" aria-label="代理列表">
          {context.rows.map((agent, index) => (
            <AgentRow
              key={agent.name}
              agent={agent}
              index={index}
              context={context}
            />
          ))}
          {!context.rows.length && (
            <p className="agents-empty">
              {context.state.query
                ? "没有匹配的代理，请调整搜索条件。"
                : "此来源暂无代理。"}
            </p>
          )}
          <button
            role="option"
            aria-selected={context.state.index === context.rows.length}
            className="agents-new-row"
            disabled={context.busy}
            onClick={context.beginCreate}
          >
            ＋ 新建代理…
          </button>
        </div>
      </div>
      {context.selected && <AgentDetails agent={context.selected} />}
    </div>
  );
}

function AgentDetails({ agent }: { agent: NativeAgent }) {
  return (
    <details className="agents-details" key={agent.name}>
      <summary>{agent.name} · 查看指令与来源</summary>
      <p>{agent.description}</p>
      {agent.filePath && <p className="agents-file-path">{agent.filePath}</p>}
      <pre>{agent.systemPrompt}</pre>
    </details>
  );
}
