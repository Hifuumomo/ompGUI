import { useEffect, useRef } from "react";
import type { AgentsHubProps } from "../../shared/native-agents";
import { useAgentsHub, type AgentsContext } from "./use-agents-hub";
import { AgentsList, AgentsSidebar } from "./agents-hub-views";
import { AgentModelPicker, AgentsStrip } from "./agents-hub-controls";
import { AgentCreate } from "./agents-hub-create";
import { agentsHubKey } from "./agents-hub-keyboard";
import "./agents-hub.css";

function AgentsBody({ context }: { context: AgentsContext }) {
  if (context.state.stage === "create")
    return <AgentCreate context={context} />;
  if (context.state.stage === "models")
    return <AgentModelPicker context={context} />;
  return <AgentsList context={context} />;
}

function AgentsFooter({ context }: { context: AgentsContext }) {
  return (
    <>
      <AgentsStrip context={context} />
      {context.error && (
        <p className="agents-feedback error" role="alert">
          {context.error}
        </p>
      )}
      <footer>
        <span role="status">
          {context.busy
            ? "正在处理…"
            : context.data.notice ||
              "↑↓ 选择 · ←→ / Tab 切换分栏 · Enter 配置 · Space 启停"}
        </span>
        <span>Ctrl+R 刷新 · Esc 返回</span>
      </footer>
    </>
  );
}

function useAgentsFocus(context: AgentsContext) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (context.state.stage === "list") dialog.current?.focus();
  }, [context.state.stage]);
  useEffect(() => {
    dialog.current
      ?.querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [context.state.index]);
  return dialog;
}

/** Fullscreen native /agents flow in the desktop palette, with mouse and keyboard access. */
export function NativeAgentsHub(props: AgentsHubProps) {
  const context = useAgentsHub(props);
  const dialog = useAgentsFocus(context);
  return (
    <div className="agents-hub-layer">
      <div
        ref={dialog}
        className="native-agents-hub"
        role="dialog"
        aria-modal="true"
        aria-label="Agents 代理管理"
        aria-busy={context.busy}
        tabIndex={-1}
        onKeyDown={(event) => agentsHubKey(event, context)}
      >
        <header>
          <div>
            <strong>Agents</strong>
            <span>代理管理</span>
          </div>
          <span>管理子代理的职责、模型与执行偏好</span>
          <button
            disabled={context.busy}
            aria-label="关闭代理管理"
            onClick={props.onClose}
          >
            ×
          </button>
        </header>
        <div className="agents-workspace">
          <AgentsSidebar context={context} />
          <main>
            <AgentsBody context={context} />
          </main>
        </div>
        <AgentsFooter context={context} />
      </div>
    </div>
  );
}
