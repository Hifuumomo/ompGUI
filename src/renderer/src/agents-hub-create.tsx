import type { AgentsContext } from "./use-agents-hub";

function CreateScope({ context }: { context: AgentsContext }) {
  return (
    <div className="agents-create-scope" role="group" aria-label="保存范围">
      <span>保存到</span>
      {(["project", "user"] as const).map((scope) => (
        <button
          key={scope}
          disabled={context.busy}
          aria-pressed={context.state.createScope === scope}
          onClick={() => context.patch({ createScope: scope })}
        >
          {scope === "project" ? "当前项目" : "用户全局"}
        </button>
      ))}
    </div>
  );
}

function AgentPreview({ context }: { context: AgentsContext }) {
  const spec = context.spec!;
  return (
    <div className="agents-create-preview">
      <span className="agents-eyebrow">生成预览</span>
      <h2>{spec.identifier}</h2>
      <p>{spec.whenToUse}</p>
      <h3>系统指令</h3>
      <pre>{spec.systemPrompt}</pre>
      <div className="agents-create-actions">
        <button
          disabled={context.busy}
          className="primary"
          onClick={context.save}
        >
          保存代理
        </button>
        <button disabled={context.busy} onClick={context.generate}>
          重新生成
        </button>
      </div>
      <small>Enter 保存 · R 重新生成 · Tab 切换保存范围 · Esc 返回列表</small>
    </div>
  );
}

export function AgentCreate({ context }: { context: AgentsContext }) {
  return (
    <section className="agents-create">
      <div className="agents-create-title">
        <div>
          <span className="agents-eyebrow">NEW AGENT</span>
          <h2>新建代理</h2>
        </div>
        <button
          disabled={context.busy}
          onClick={() => context.patch({ stage: "list", scope: "all" })}
        >
          返回列表
        </button>
      </div>
      <CreateScope context={context} />
      {context.spec ? (
        <AgentPreview context={context} />
      ) : (
        <AgentDescription context={context} />
      )}
    </section>
  );
}

function AgentDescription({ context }: { context: AgentsContext }) {
  return (
    <>
      <label>
        描述代理的职责与适用场景
        <textarea
          autoFocus
          aria-label="代理用途描述"
          rows={6}
          value={context.state.description}
          placeholder="例如：审查代码变更，重点检查并发问题，并给出有证据的修复建议。"
          disabled={context.busy}
          onChange={(event) =>
            context.patch({ description: event.target.value })
          }
        />
      </label>
      <p>使用当前模型生成代理定义，预览后再保存。</p>
      <button
        className="primary"
        disabled={context.busy || !context.state.description.trim()}
        onClick={context.generate}
      >
        {context.busy ? "正在生成…" : "生成代理"}
      </button>
      <small>Ctrl+Enter / Alt+Enter 生成 · Enter 换行 · Tab 切换保存范围</small>
      {context.stream && (
        <pre className="agents-generation" aria-label="生成中的代理定义">
          {context.stream}
        </pre>
      )}
    </>
  );
}
