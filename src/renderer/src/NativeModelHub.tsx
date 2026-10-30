import { useEffect, useRef, type KeyboardEvent } from "react";
import type { NativeModelHubProps } from "../../shared/native-model";
import type { HubActionContext } from "./model-hub-context";
import { modelHubKey } from "./model-hub-keyboard";
import { roleRows, visibleModels } from "./model-hub-state";
import { ModelHubSidebar } from "./model-hub-views";
import {
  ModelHubTabs,
  ModelHubBody,
  ModelHubFooter,
  quickRoles,
} from "./model-hub-panels";
import { useModelHub } from "./use-model-hub";
import "./model-hub.css";

function ModelHubHeader({ context }: { context: HubActionContext }) {
  const { state, temporary, close } = context;
  const title = temporary
    ? state.task
      ? "Switch Task Model"
      : "Switch Model"
    : "Models";
  const hint = state.assigning
    ? `Assign ${state.assigning.role} · Esc back`
    : temporary
      ? state.task
        ? "Task subagent switch — spawned task agents use this model (session-only)"
        : state.query.startsWith("@")
          ? "Quick role switch — applies its model and thinking for this session"
          : "Session-only switch — role models stay unchanged"
      : "←/→ panes · Alt+←/→ tabs · F5 refresh";
  return (
    <header>
      <strong>{title}</strong>
      <span>{hint}</span>
      <button aria-label="Close model settings" onClick={close}>
        ×
      </button>
    </header>
  );
}

function ModelHubSearch({ context }: { context: HubActionContext }) {
  return (
    <input
      className="model-hub-search"
      autoComplete="off"
      spellCheck={false}
      aria-controls="model-hub-options"
      aria-activedescendant={`model-hub-option-${context.state.index}`}
      aria-label="Search models"
      placeholder={
        context.temporary && !context.state.task
          ? "Search models, @ for quick roles…"
          : "Search models…"
      }
      value={context.state.query}
      onChange={(event) =>
        context.patch({ query: event.target.value, index: 0, focus: "list" })
      }
    />
  );
}

function ModelHubWorkspace({ context }: { context: HubActionContext }) {
  const { data, state, patch, temporary } = context;
  const rolesView = state.scope === "roles" && !state.assigning;
  const select = (scope: string) =>
    patch({
      scope,
      index: 0,
      focus: scope === "roles" ? "list" : "scope",
      assigning: scope === "roles" ? undefined : state.assigning,
    });
  return (
    <div className="model-hub-layout">
      {!temporary && (
        <ModelHubSidebar data={data} state={state} select={select} />
      )}
      <main
        className={`model-hub-main ${state.focus === "list" ? "has-focus" : ""}`}
      >
        {!temporary && <ModelHubTabs context={context} />}
        {!rolesView && <ModelHubSearch context={context} />}
        <ModelHubBody context={context} />
      </main>
    </div>
  );
}

function ModelHubStatus(props: {
  busy: boolean;
  error: string;
  notice?: string;
}) {
  return (
    <>
      {props.busy && (
        <p className="model-hub-status" role="status">
          Applying…
        </p>
      )}
      {props.error && (
        <p className="model-hub-error" role="alert">
          {props.error}
        </p>
      )}
      {props.notice && (
        <p className="model-hub-status" role="status">
          {props.notice}
        </p>
      )}
    </>
  );
}

function handleHubKey(event: KeyboardEvent, context: HubActionContext) {
  const rolesView = context.state.scope === "roles" && !context.state.assigning;
  const roles = quickRoles(context);
  if (
    context.temporary &&
    !context.state.task &&
    context.state.query.startsWith("@") &&
    event.key === "Enter"
  ) {
    event.preventDefault();
    event.stopPropagation();
    const role = roles[context.state.index];
    if (role)
      context.run(
        {
          op: "applyRole",
          role: role.role,
          target: context.state.task ? "task" : "session",
        },
        context.close,
      );
    return;
  }
  const models =
    context.temporary && !context.state.task && context.state.query.startsWith("@")
      ? roles.flatMap((role) =>
          context.data.models.filter(
            (model) => model.selector === role.resolvedSelector,
          ),
        )
      : visibleModels(context.data, context.state);
  modelHubKey(event, context, {
    models,
    rows: roleRows(context.data, context.state.roleTab),
    rolesView,
  });
}

/** Fullscreen /model and bottom-anchored temporary selection share native data and actions. */
export function NativeModelHub(props: NativeModelHubProps) {
  const runtime = useModelHub(props);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (props.temporary) container.current?.querySelector<HTMLInputElement>("input")?.focus();
    else container.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, [props.temporary]);
  const context: HubActionContext = {
    ...runtime,
    close: props.onClose,
    temporary: props.temporary === true,
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (props.temporary && event.key === "Tab") {
      event.preventDefault();
      const items = [...container.current!.querySelectorAll<HTMLElement>('input, button:not(:disabled):not([role="option"])')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") &&
        event.target instanceof Element && event.target.closest('button:not([role="option"])')) {
      event.stopPropagation();
      return;
    }
    if (runtime.busy) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") props.onClose();
      return;
    }
    handleHubKey(event, context);
  };
  return (
    <div className={`model-hub-layer ${props.temporary ? "is-temporary" : ""}`}>
      <div
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label={props.temporary ? runtime.state.task ? "Switch Task Model" : "Switch Model" : "Models"}
        aria-busy={runtime.busy}
        tabIndex={-1}
        className={`native-model-hub ${runtime.state.task ? "task-target" : ""}`}
        onKeyDown={onKeyDown}
      >
        <ModelHubHeader context={context} />
        <ModelHubWorkspace context={context} />
        <ModelHubStatus
          busy={runtime.busy}
          error={runtime.error}
          notice={runtime.data.notice}
        />
        <ModelHubFooter context={context} />
      </div>
    </div>
  );
}
