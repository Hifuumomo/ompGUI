import { useEffect, useRef } from "react";
import type {
  NativeCatalogModel,
  NativeModelSnapshot,
} from "../../shared/native-model";
import type { HubRoleRow, HubState, HubStrip } from "./model-hub-state";
import { hubScopes, modelNumber } from "./model-hub-state";

export function ModelHubSidebar(props: {
  data: NativeModelSnapshot;
  state: HubState;
  select: (id: string) => void;
}) {
  return (
    <nav
      className={`model-hub-sidebar ${props.state.focus === "scope" ? "has-focus" : ""}`}
      aria-label="Model scopes"
    >
      {hubScopes(props.data).map((scope) => (
        <button
          key={scope.id}
          className={`${props.state.scope === scope.id ? "selected" : ""} ${scope.locked ? "locked" : ""}`}
          onClick={() => props.select(scope.id)}
        >
          <span>
            {scope.locked ? "◇ " : ""}
            {scope.label}
          </span>
          <small>{scope.locked ? "locked" : scope.count}</small>
        </button>
      ))}
    </nav>
  );
}

function price(model: NativeCatalogModel) {
  if (!model.cost) return "—";
  if (model.cost.input === 0 && model.cost.output === 0) return "free";
  return `$${model.cost.input}·${model.cost.output}`;
}

/** 原生目录有评分时展示脑子图标；缺失时保持未知，不推算分数。 */
function Intelligence({ value }: { value?: number }) {
  return (
    <span
      className="model-intelligence"
      aria-label={value === undefined ? "智力值未知" : `智力值 ${value}`}
      title="原生模型智力值"
    >
      {value === undefined ? (
        "—"
      ) : (
        <>
          <span aria-hidden="true">🧠</span> {value}
        </>
      )}
    </span>
  );
}

function ModelRow(props: {
  model: NativeCatalogModel;
  data: NativeModelSnapshot;
  selected: boolean;
  pick: () => void;
  overContext: boolean;
  temporary?: boolean;
  index: number;
}) {
  const { model, data } = props;
  const roles = data.roles.filter(
    (role) => role.resolvedSelector === model.selector,
  );
  return (
    <button
      role="option"
      id={`model-hub-option-${props.index}`}
      tabIndex={-1}
      aria-selected={props.selected}
      className={`model-hub-model ${props.selected ? "selected" : ""} ${props.overContext ? "over-context" : ""}`}
      onClick={props.pick}
    >
      <span className="model-hub-model-name">
        {props.temporary && <span className="model-hub-cursor" aria-hidden="true">{props.selected ? "›" : " "}</span>}
        <span className="model-hub-provider">{model.provider}/</span>
        {model.id}
        {data.currentSelector === model.selector && (
          <b className="model-hub-current" aria-label="当前模型"> ●</b>
        )}
        {!props.temporary && <span className="model-hub-tags">
          {roles.map((role) => (
            <small
              key={role.role}
              data-role-tone={
                role.autoSelected ? "dim" : (role.color ?? "muted")
              }
            >
              {role.autoSelected ? "○" : "●"} {role.role}
            </small>
          ))}
        </span>}
      </span>
      <Intelligence value={model.intelligence} />
      <span>{modelNumber(model.tps)}{props.temporary && model.tps !== undefined ? "t/s" : ""}</span>
      <span>{modelNumber(model.contextWindow)}</span>
      <span>{price(model)}</span>
    </button>
  );
}

interface ModelHubListProps {
  models: readonly NativeCatalogModel[];
  data: NativeModelSnapshot;
  state: HubState;
  select: (index: number) => void;
  activate: (model: NativeCatalogModel) => void;
  temporary: boolean;
}

export function ModelHubList(props: ModelHubListProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [props.state.index]);
  const model = props.models[props.state.index];
  return (
    <>
      {!props.temporary && <div className="model-hub-columns">
        <span>Model</span>
        <span title="智力值">🧠</span>
        <span>t/s</span>
        <span>Ctx</span>
        <span>$/M</span>
      </div>}
      <div
        ref={list}
        id="model-hub-options"
        className="model-hub-list"
        role="listbox"
        aria-label="Models"
      >
        {props.models.map((item, index) => (
          <ModelRow
            key={item.selector}
            model={item}
            data={props.data}
            index={index}
            temporary={props.temporary}
            selected={index === props.state.index}
            overContext={
              props.temporary &&
              !!item.contextWindow &&
              (props.data.currentContextTokens ?? 0) > item.contextWindow
            }
            pick={() =>
              props.temporary || index === props.state.index
                ? props.activate(item)
                : props.select(index)
            }
          />
        ))}
        {!props.models.length && (
          <p className="model-hub-empty" role="status">
            {props.state.query !== props.data.query ? "Searching…" : "No matching models"}
          </p>
        )}
      </div>
      <ModelHubDetails model={model} data={props.data} compact={props.temporary} />
    </>
  );
}

export function ModelHubDetails({ model, data, compact }: {
  model?: NativeCatalogModel;
  data?: NativeModelSnapshot;
  compact?: boolean;
}) {
  if (!model) return <div className="model-hub-details" />;
  if (compact) return (
    <div className="model-hub-details model-hub-compact-details">
      <div>
        <strong>{model.name}</strong> · {modelNumber(model.contextWindow)} ctx · {modelNumber(model.maxTokens)} out · {price(model)} per M
        {model.reasoning && " · reasoning"}{model.input?.includes("image") && " · vision"}
        {model.intelligence !== undefined && <> · <Intelligence value={model.intelligence} /></>}
        {model.tps !== undefined && ` · ~${modelNumber(model.tps)}t/s`}
      </div>
      <div className="model-hub-detail-roles">
        {data?.currentSelector === model.selector && <span>● current</span>}
        {data?.roles.filter((role) => role.resolvedSelector === model.selector).map((role) => (
          <span key={role.role} data-role-tone={role.autoSelected ? "dim" : (role.color ?? "muted")}>
            {role.autoSelected ? "○" : "●"} {role.role} · {role.thinkingLevel ?? "inherit"}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div className="model-hub-details">
      <strong>{model.name}</strong>
      <span>{model.selector}</span>
      <p>{model.description}</p>
      <Intelligence value={model.intelligence} />
      <div>
        {model.kind} · {model.input?.join(" / ")} · context{" "}
        {modelNumber(model.contextWindow)} · output{" "}
        {modelNumber(model.maxTokens)} · {price(model)} / 1M tokens
      </div>
      {model.compaction && (
        <div>
          Compaction {modelNumber(model.compaction.tokens)} ·{" "}
          {model.compaction.source}
        </div>
      )}
    </div>
  );
}

function roleLabel(row: HubRoleRow, data: NativeModelSnapshot) {
  if (row.kind === "newRole") return "+ New role…";
  if (row.kind === "newFallback") return "+ New fallback chain…";
  if (row.kind === "fallback") return `↳ ${row.chainIndex! + 1}`;
  const role = data.roles.find((item) => item.role === row.role);
  const cycleIndex = data.cycleOrder.indexOf(row.role!);
  return `${cycleIndex >= 0 ? `${cycleIndex + 1} ` : ""}${role?.tag ?? row.role}${role ? ` · ${role.name}` : ""}`;
}

interface ModelHubRolesProps {
  rows: readonly HubRoleRow[];
  data: NativeModelSnapshot;
  state: HubState;
  select: (index: number) => void;
  activate: (row: HubRoleRow) => void;
}

export function ModelHubRoles(props: ModelHubRolesProps) {
  const list = useSelectionScroll(props.state.index);
  return (
    <>
      <div className="model-hub-preset">
        Preset: {props.data.presets.active ?? "custom"}
        <span>Ctrl+←/→ · p/P</span>
      </div>
      <div className="model-hub-role-columns">
        <span>Role / Ctrl+P</span>
        <span>Model</span>
        <span>Thinking</span>
      </div>
      <div
        ref={list}
        className="model-hub-list"
        role="listbox"
        aria-label="Model roles"
      >
        {props.rows.map((row, index) => {
          const role = props.data.roles.find((item) => item.role === row.role);
          return (
            <button
              role="option"
              aria-selected={index === props.state.index}
              key={row.id}
              className={`model-hub-role ${index === props.state.index ? "selected" : ""}`}
              onClick={() =>
                index === props.state.index
                  ? props.activate(row)
                  : props.select(index)
              }
            >
              <span
                className="model-role-label"
                data-role-tone={
                  role?.autoSelected ? "dim" : (role?.color ?? "muted")
                }
                data-role-auto={role?.autoSelected || undefined}
              >
                {role && row.kind === "role" && (
                  <span aria-hidden="true">
                    {role.autoSelected ? "○ " : "● "}
                  </span>
                )}
                {roleLabel(row, props.data)}
              </span>
              <span>
                {row.selector ?? role?.value ?? role?.resolvedSelector}
                {role?.autoSelected && row.kind === "role" ? " (auto)" : ""}
              </span>
              <span>{row.kind === "role" ? role?.thinkingLevel : ""}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function useSelectionScroll(index: number) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [index]);
  return list;
}

export function ModelHubStrip(props: {
  strip: HubStrip;
  update: (strip: HubStrip) => void;
}) {
  const { strip } = props;
  if (strip.kind === "name")
    return (
      <label className="model-hub-strip">
        <span>{strip.title}</span>
        <input
          autoFocus
          value={strip.value}
          onChange={(event) =>
            props.update({ ...strip, value: event.target.value })
          }
        />
        <small>Enter submit · Esc cancel</small>
      </label>
    );
  return (
    <div className="model-hub-strip">
      <span>{strip.title}</span>
      <div className="model-hub-chips">
        {strip.choices.map((choice, index) => (
          <button
            key={`${choice.label}-${index}`}
            className={index === strip.index ? "selected" : ""}
            onClick={choice.choose}
          >
            {choice.active ? "✓ " : ""}
            {choice.label}
          </button>
        ))}
      </div>
      <small>←/→ choose · Enter apply · Esc back</small>
    </div>
  );
}
