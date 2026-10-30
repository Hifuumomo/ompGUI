import {
  activateRole,
  pickHubModel,
  roleAction,
  type HubActionContext,
} from "./model-hub-actions";
import { cancelModelHub } from "./model-hub-keyboard";
import {
  MODEL_KIND_TABS,
  ROLE_TABS,
  roleRows,
  visibleModels,
} from "./model-hub-state";
import { ModelHubList, ModelHubRoles, ModelHubStrip, ModelHubDetails } from "./model-hub-views";

export function ModelHubTabs({ context }: { context: HubActionContext }) {
  const roles = context.state.scope === "roles" && !context.state.assigning;
  const tabs = roles ? ROLE_TABS : MODEL_KIND_TABS;
  const selected = roles ? context.state.roleTab : context.state.kind;
  return (
    <div
      className="model-hub-tabs"
      role="tablist"
      aria-label={roles ? "Role kinds" : "Model kinds"}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={selected === tab}
          onClick={() =>
            context.patch(
              roles ? { roleTab: tab, index: 0 } : { kind: tab, index: 0 },
            )
          }
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function ModelHubBody({ context }: { context: HubActionContext }) {
  const { data, state, patch } = context;
  const rolesView = state.scope === "roles" && !state.assigning;
  const provider = data.providers.find(
    (item) => `provider:${item.id}` === state.scope,
  );
  if (provider?.locked && !state.assigning)
    return (
      <div className="model-hub-empty">
        <h2>{provider.id}</h2>
        <p>This provider is not authenticated.</p>
        <p>{provider.error}</p>
        {provider.oauth ? (
          <button
            onClick={() => context.run({ op: "login", provider: provider.id })}
          >
            Enter · Log in
          </button>
        ) : (
          <p>Configure this provider’s API key, then press F5 to refresh.</p>
        )}
      </div>
    );
  if (context.temporary && !state.task && state.query.startsWith("@"))
    return <QuickRoles context={context} />;
  if (rolesView)
    return (
      <ModelHubRoles
        rows={roleRows(data, state.roleTab)}
        data={data}
        state={state}
        select={(index) => patch({ index, focus: "list" })}
        activate={(row) => activateRole(context, row)}
      />
    );
  return (
    <ModelHubList
      models={visibleModels(data, state)}
      data={data}
      state={state}
      temporary={context.temporary}
      select={(index) => patch({ index, focus: "list" })}
      activate={(model) => pickHubModel(context, model)}
    />
  );
}

export function quickRoles(context: HubActionContext) {
  const query = context.state.query.slice(1).toLowerCase();
  return context.data.cycleOrder.flatMap((id) =>
    context.data.roles.filter(
      (role) =>
        role.role === id &&
        (role.value || role.role === "default") &&
        !!role.resolvedSelector &&
        context.data.models.some((model) => model.selector === role.resolvedSelector && model.kind === "chat") &&
        role.role.toLowerCase().includes(query),
    ),
  );
}

function QuickRoles({ context }: { context: HubActionContext }) {
  const roles = quickRoles(context);
  const selected = context.data.models.find((model) => model.selector === roles[context.state.index]?.resolvedSelector);
  return (
    <>
    <div className="model-hub-list" id="model-hub-options" role="listbox" aria-label="Quick roles">
      {roles.map((role, index) => (
        <button
          role="option"
          id={`model-hub-option-${index}`}
          tabIndex={-1}
          aria-selected={index === context.state.index}
          key={role.role}
          className={`model-hub-quick ${index === context.state.index ? "selected" : ""}`}
          onClick={() =>
            context.run(
              { op: "applyRole", role: role.role, target: "session" },
              context.close,
            )
          }
        >
          <span className="model-hub-cursor" aria-hidden="true">{index === context.state.index ? "›" : " "}</span>
          <strong
            data-role-tone={role.autoSelected ? "dim" : (role.color ?? "muted")}
          >
            @{role.role}
          </strong>
          <span>{role.resolvedSelector}</span>
          <small>{role.thinkingLevel}</small>
        </button>
      ))}
      {!roles.length && <p>No quick roles in the Ctrl+P cycle</p>}
    </div>
    <ModelHubDetails model={selected} data={context.data} compact />
    </>
  );
}

const ROLE_ACTION_HINTS = [
  ["Enter", "pick"],
  ["x", "clear"],
  ["f", "fallback"],
  ["c", "Ctrl+P"],
  ["[", "earlier"],
  ["]", "later"],
  ["n", "new"],
  ["t", "thinking"],
  ["k", "compaction"],
  ["s", "save preset"],
];

export function ModelHubFooter({ context }: { context: HubActionContext }) {
  if (context.state.strip)
    return (
      <ModelHubStrip
        strip={context.state.strip}
        update={(strip) => context.patch({ strip })}
      />
    );
  const rolesView = context.state.scope === "roles" && !context.state.assigning;
  const actions = rolesView ? ROLE_ACTION_HINTS : [];
  const row = roleRows(context.data, context.state.roleTab)[
    context.state.index
  ];
  return (
    <footer className="model-hub-footer">
      {actions.map(([key, label]) => (
        <button key={key} onClick={() => roleAction(context, row, key)}>
          <kbd>{key}</kbd>
          {label}
        </button>
      ))}
      {!rolesView && (
        <span>
          ↑/↓ {context.temporary && !context.state.task && context.state.query.startsWith("@") ? "roles" : "models"} · Enter{" "}
          {context.temporary
            ? context.state.task ? "use for Task subagents"
              : context.state.query.startsWith("@") ? "apply role model" : "use for this session"
            : "assign role"} · type to search
          {context.temporary && !context.state.task && !context.state.query.startsWith("@") && " · @ quick roles"}
        </span>
      )}
      {context.temporary && (
        <button onClick={() => context.patch({
          task: !context.state.task,
          query: context.state.query.startsWith("@") ? "" : context.state.query,
          index: 0,
        })}>
          Alt+P · {context.state.task ? "session model" : "task model"}
        </button>
      )}
      <button onClick={() => cancelModelHub(context)}>
        <kbd>Esc</kbd>
        {context.state.query ? "clear search" : "close"}
      </button>
    </footer>
  );
}
