import type { RefObject } from "react";
import type { HubState } from "./use-subagent-hub";
import { HubToolbar } from "./subagent-hub-controls";

/** 展示两行导航及对话返回入口。
 * @param state [in] 当前 Hub 状态及操作。
 * @param search [in] 搜索框引用，供键盘快捷键聚焦。
 * @param onClose [in] 关闭面板的回调。
 * @returns 标题页签行与搜索工具行。
 */
export function HubNavigation({
  state,
  search,
  onClose,
}: {
  readonly state: HubState;
  readonly search: RefObject<HTMLInputElement | null>;
  readonly onClose: () => void;
}) {
  return (
    <>
      <HubTitle state={state} onClose={onClose} />
      {state.transcript ? (
        <div className="subagent-toolbar">
          <button onClick={() => state.setTranscriptId(undefined)}>
            ← 返回活动
          </button>
          <strong>
            {state.transcript.agent} · {state.transcript.id}
          </strong>
        </div>
      ) : (
        <div className="subagent-toolbar">
          <input
            ref={search}
            aria-label="搜索子代理活动"
            placeholder="/ 搜索代理、任务或活动"
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
          />
          <HubToolbar state={state} />
        </div>
      )}
    </>
  );
}

/** 将标题、代理计数和分段页签置于同一行。
 * @param state [in] 当前 Hub 状态。
 * @param onClose [in] 关闭面板的回调。
 * @returns 顶部标题行。
 */
function HubTitle({
  state,
  onClose,
}: {
  readonly state: HubState;
  readonly onClose: () => void;
}) {
  return (
    <header className="subagent-header">
      <h1>Agent Hub</h1>
      <span className="subagent-count" title="当前窗口的子代理数量">
        当前窗口 · {state.data.agents.length} 个代理
      </span>
      {!state.transcript && <HubTabs state={state} />}
      <button className="subagent-close" onClick={onClose} aria-label="关闭子代理活动">
        关闭 ×
      </button>
    </header>
  );
}

/** 展示可切换的 Agents / Activity 分段页签。
 * @param state [in] 当前页签状态及切换操作。
 * @returns 带可访问选中状态的页签组。
 */
function HubTabs({ state }: { readonly state: HubState }) {
  return (
    <div className="subagent-tabs" role="tablist" aria-label="活动页签">
      <button
        role="tab"
        aria-selected={state.tab === "agents"}
        onClick={() => state.setTab("agents")}
      >
        1 Agents · 代理
      </button>
      <button
        role="tab"
        aria-selected={state.tab === "activity"}
        onClick={() => state.setTab("activity")}
      >
        2 Activity · 活动
      </button>
    </div>
  );
}
