import { HubNavigation } from "./subagent-hub-navigation";
import { useEffect, useRef } from "react";
import { useHubState, hubActions } from "./use-subagent-hub";
import { HubConnection, type SubagentHubProps } from "./subagent-hub-controls";
import { handleSubagentKey } from "./subagent-hub-keyboard";
import { createDoubleArrow } from "./subagent-shortcut";
import "./subagent-activity.css";
function useHubFocus(
  open: boolean,
  selected: string | undefined,
  page: string,
) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [open, page]);
  useEffect(() => {
    dialog.current
      ?.querySelector('[aria-selected="true"][role="option"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return dialog;
}

/** Keep the monitor mounted per connection to retain observed completions. */
export function SubagentActivityHub(props: SubagentHubProps) {
  const state = useHubState(props);
  const selected = state.tab === "agents" ? state.agent?.id : state.row?.id;
  const dialog = useHubFocus(
    props.open,
    selected,
    state.transcript?.id ?? state.tab,
  );
  const search = useRef<HTMLInputElement>(null);
  const actions = hubActions(state, props.onClose);
  const doubleArrow = useRef(createDoubleArrow());
  if (!props.open) return null;
  return (
    <div className="subagent-layer">
      <div
        ref={dialog}
        className="subagent-hub"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="子代理活动"
        onKeyDown={(event) =>
          handleSubagentKey(
            event,
            {
              ...actions,
              search: () => search.current?.focus(),
            },
            doubleArrow.current,
          )
        }
      >
        <HubNavigation state={state} search={search} onClose={props.onClose} />
        <HubConnection state={state} props={props} />
        <footer>
          <span>
            ↑↓ / J K 选择 · Enter / 双击查看对话 · 1 / 2 切换 · Esc 返回
          </span>
          <span>{props.connected ? "历史记录 + 当前连接实时活动" : "只读历史 · 不接管原会话"}</span>
        </footer>
      </div>
    </div>
  );
}
