import { useEffect, useRef, useState } from "react";
import type { AgentProperty } from "../../shared/native-agents";
import {
  overrideValue,
  PROPERTY_LABELS,
  propertyValue,
} from "./agents-hub-state";
import type { AgentsContext } from "./use-agents-hub";

function setValue(context: AgentsContext, value?: string) {
  if (!context.selected) return;
  context.run(
    {
      op: "override",
      name: context.selected.name,
      property: context.state.property,
      value,
    },
    () => context.patch({ stage: "list" }),
  );
}

function AgentProperties({ context }: { context: AgentsContext }) {
  const agent = context.selected!;
  return (
    <>
      <button
        disabled={context.busy}
        onClick={() =>
          context.run(
            { op: "toggle", name: agent.name, disabled: !agent.disabled },
            () => context.patch({ stage: "list" }),
          )
        }
      >
        {agent.disabled ? "○ 已禁用 · 启用" : "● 已启用 · 禁用"}
      </button>
      {(["model", "prewalk", "advisor"] as const).map((property) => (
        <button
          key={property}
          disabled={context.busy}
          onClick={() => context.patch({ property, stage: "property" })}
        >
          {PROPERTY_LABELS[property]}{" "}
          <small>{propertyValue(agent, property)}</small>
        </button>
      ))}
    </>
  );
}

function PropertyOptions({ context }: { context: AgentsContext }) {
  const property = context.state.property;
  const current = overrideValue(context.selected!, property);
  return (
    <>
      {property !== "model" &&
        [
          { label: "代理默认", value: undefined },
          { label: "开启", value: "on" },
          { label: "关闭", value: "off" },
        ].map((item) => (
          <button
            key={item.label}
            aria-pressed={current === item.value}
            disabled={context.busy}
            onClick={() => setValue(context, item.value)}
          >
            {item.label}
          </button>
        ))}
      <button
        disabled={context.busy}
        onClick={() => context.patch({ stage: "models", modelQuery: "" })}
      >
        选择模型…
      </button>
      <button
        disabled={context.busy}
        onClick={() =>
          context.patch({ stage: "pattern", pattern: current ?? "" })
        }
      >
        输入表达式…
      </button>
      {property === "model" && current && (
        <button disabled={context.busy} onClick={() => setValue(context)}>
          清除覆盖
        </button>
      )}
    </>
  );
}

function PatternInput({ context }: { context: AgentsContext }) {
  return (
    <form
      className="agents-pattern"
      onSubmit={(event) => {
        event.preventDefault();
        if (!context.busy)
          setValue(context, context.state.pattern.trim() || undefined);
      }}
    >
      <input
        autoFocus
        aria-label="模型表达式"
        placeholder="例如 @smol 或 provider/model；留空清除覆盖"
        value={context.state.pattern}
        disabled={context.busy}
        onChange={(event) => context.patch({ pattern: event.target.value })}
      />
      <button type="submit" disabled={context.busy}>
        保存
      </button>
    </form>
  );
}

export function AgentsStrip({ context }: { context: AgentsContext }) {
  const strip = useRef<HTMLDivElement>(null);
  const stage = context.state.stage;
  useEffect(() => {
    const selector =
      stage === "agent" ? "button:nth-of-type(2)" : "input, button";
    strip.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [stage]);
  if (!context.selected || !["agent", "property", "pattern"].includes(stage))
    return null;
  return (
    <div className="agents-strip" ref={strip}>
      <div>
        <strong>{context.selected.name}</strong>
        <span>
          {stage === "agent"
            ? "配置代理"
            : PROPERTY_LABELS[context.state.property]}
        </span>
      </div>
      {stage === "agent" ? (
        <AgentProperties context={context} />
      ) : stage === "property" ? (
        <PropertyOptions context={context} />
      ) : (
        <PatternInput context={context} />
      )}
      <button
        className="agents-back"
        disabled={context.busy}
        onClick={() =>
          context.patch({
            stage:
              stage === "pattern"
                ? "property"
                : stage === "property"
                  ? "agent"
                  : "list",
          })
        }
      >
        返回
      </button>
    </div>
  );
}

function useAgentModelPicker(context: AgentsContext) {
  const current =
    context.selected && overrideValue(context.selected, context.state.property);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      context.data.models.findIndex((model) => model.selector === current),
    ),
  );
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [index]);
  const matches = context.data.models.filter((model) =>
    `${model.selector} ${model.name}`
      .toLowerCase()
      .includes(context.state.modelQuery.toLowerCase()),
  );
  const onKeyDown = (event: import("react").KeyboardEvent) => {
    if (context.busy) return;
    if (event.key === "ArrowDown")
      setIndex(Math.min(matches.length - 1, index + 1));
    else if (event.key === "ArrowUp") setIndex(Math.max(0, index - 1));
    else if (event.key === "Enter" && matches[index])
      setValue(context, matches[index].selector);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return { index, setIndex, matches, onKeyDown, list };
}

export function AgentModelPicker({ context }: { context: AgentsContext }) {
  const { index, setIndex, matches, onKeyDown, list } =
    useAgentModelPicker(context);
  const property: AgentProperty = context.state.property;
  return (
    <section className="agents-model-picker" onKeyDown={onKeyDown}>
      <h2>
        {context.selected?.name} / {PROPERTY_LABELS[property]}
      </h2>
      <p>选择模型后保存为此代理的覆盖配置。</p>
      <input
        autoFocus
        aria-label="搜索代理模型"
        placeholder="搜索可用模型…"
        value={context.state.modelQuery}
        onChange={(event) => {
          context.patch({ modelQuery: event.target.value });
          setIndex(0);
        }}
      />
      <div ref={list} role="listbox" aria-label="可用模型">
        {matches.map((model, row) => (
          <button
            role="option"
            aria-selected={index === row}
            key={model.selector}
            disabled={context.busy}
            onClick={() => setValue(context, model.selector)}
          >
            <strong>{model.name}</strong>
            <small>{model.selector}</small>
          </button>
        ))}
      </div>
      {!matches.length && <p className="agents-empty">没有匹配的可用模型。</p>}
      <button
        disabled={context.busy}
        onClick={() => context.patch({ stage: "property" })}
      >
        返回属性
      </button>
    </section>
  );
}
