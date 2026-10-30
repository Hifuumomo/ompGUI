import { useState } from "react";
import type { RefObject } from "react";
import type { NativeCatalogModel, NativeModelSnapshot } from "../../shared/native-model";
import type { PlanSnapshot } from "../../shared/native-plan";
import { usePopover } from "./usePopover";

type Selection = PlanSnapshot["executionModel"];

/** 模型选择只更新待批准配置，保留浮层以便继续设置思考强度。 */
export function PlanModelPicker({ catalog, selection, onChange, onClose, trigger }: {
  catalog?: NativeModelSnapshot;
  selection: Selection;
  onChange: (selection: Selection) => void;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const [search, setSearch] = useState("");
  const popover = usePopover(onClose, trigger);
  const query = search.toLowerCase();
  const selected = catalog?.models.find((model) => model.provider === selection?.provider && model.id === selection.modelId);
  const defaultSelector = catalog?.roles.find((role) => role.role === "default")?.resolvedSelector;
  const groups = new Map<string, NativeCatalogModel[]>();
  for (const provider of catalog?.providers ?? []) {
    if (provider.locked && provider.id.toLowerCase().includes(query)) groups.set(provider.id, []);
  }
  for (const model of catalog?.models ?? []) {
    if (!`${model.provider} ${model.id} ${model.name}`.toLowerCase().includes(query)) continue;
    const group = groups.get(model.provider);
    if (group) group.push(model);
    else groups.set(model.provider, [model]);
  }
  const selectedLocked = catalog?.providers.some((provider) => provider.id === selected?.provider && provider.locked);

  return <div {...popover} className="plan-popover plan-model-picker" role="dialog" aria-label="选择执行模型">
    <input className="plan-model-search" type="search" aria-label="搜索模型" placeholder="搜索提供商、模型 ID 或名称" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="plan-model-list" role="radiogroup" aria-label="执行模型">
      {selection && !selected && <button type="button" className="plan-model-row" role="radio" aria-checked disabled>
        <span>{selection.provider}/{selection.modelId}</span><span className="plan-model-badge">当前不可用</span>
      </button>}
      {[...groups].map(([provider, models]) => {
        const locked = catalog?.providers.some((item) => item.id === provider && item.locked) ?? false;
        return <section className="plan-model-group" key={provider} role="group" aria-label={provider}>
          <h3>{provider}{locked && <span className="plan-model-badge">🔒 需在 /model 配置授权</span>}</h3>
          {models.map((model) => {
            const nonChat = Boolean(model.kind && model.kind !== "chat");
            const checked = selection?.provider === model.provider && selection.modelId === model.id;
            return <button type="button" className="plan-model-row" role="radio" aria-checked={checked} disabled={locked || nonChat} key={model.selector} title={`${model.provider}/${model.id}`} onClick={() => onChange({ provider: model.provider, modelId: model.id })}>
              <span>{model.name || model.id}</span>
              {model.selector === defaultSelector && <span className="plan-model-badge">默认</span>}
              {nonChat && <span className="plan-model-badge">非聊天模型</span>}
            </button>;
          })}
        </section>;
      })}
      {!groups.size && <p className="plan-model-empty">{catalog ? "没有匹配的模型" : "正在加载模型目录…"}</p>}
    </div>
    {selected?.reasoning && <div className="plan-thinking" role="radiogroup" aria-label="思考强度">
      {["inherit", ...selected.thinkingLevels.filter((level) => level !== "inherit")].map((level) => <button type="button" role="radio" key={level} aria-checked={(selection?.thinkingLevel ?? "inherit") === level} disabled={selectedLocked || Boolean(selected.kind && selected.kind !== "chat")} onClick={() => {
        if (selection) onChange({ ...selection, thinkingLevel: level === "inherit" ? undefined : level });
      }}>{level === "inherit" ? "继承" : level}</button>)}
    </div>}
  </div>;
}
