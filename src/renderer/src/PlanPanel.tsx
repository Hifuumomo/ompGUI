import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { NativeModelSnapshot } from "../../shared/native-model";
import type { PlanChoice, PlanSnapshot } from "../../shared/native-plan";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { PlanModelPicker } from "./PlanModelPicker";
import { PlanToc, usePlanToc } from "./PlanToc";
import { usePopover } from "./usePopover";
import type { PlanController } from "./usePlan";
import { NotifiedPlanError } from "./usePlan";
import "./plan-panel.css";

const PlanEditor = lazy(() => import("./PlanEditor").then((module) => ({ default: module.PlanEditor })));
type ActionChoice = Exclude<PlanChoice, "refine">;
const choices: { id: ActionChoice; label: string; detail: string }[] = [
  { id: "compact", label: "批准并压缩执行", detail: "同一会话；先压缩，再执行计划" },
  { id: "keep", label: "批准并保留上下文", detail: "同一会话；完整保留上下文，不压缩" },
  { id: "execute", label: "批准并新会话执行", detail: "新会话；保留原历史，复制计划与本地依赖" },
  { id: "save", label: "保存并新建会话", detail: "保存到所选路径，不退出桌面程序" },
];

/** 菜单选择同时执行并记忆；无法执行的历史选择只在当前审阅临时回退。 */
function ChoiceMenu({ current, disabled, onChoose, onClose, trigger }: {
  current: ActionChoice; disabled: (choice: ActionChoice) => boolean;
  onChoose: (choice: ActionChoice) => void; onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const popover = usePopover(onClose, trigger);
  return <div ref={popover.ref} onKeyDown={popover.onKeyDown} className="plan-popover plan-choice-menu" role="menu" aria-label="计划处置">
    {choices.map((choice) => <button type="button" role="menuitem" className={`plan-choice${choice.id === current ? " preferred" : ""}`} key={choice.id} disabled={disabled(choice.id)} onClick={() => onChoose(choice.id)}>
      <strong>{choice.id === current ? "✓ " : ""}{choice.label}</strong>
      <span>{choice.id === "keep" && disabled("keep") ? "上下文超过 95% 或执行模型不可用，不能保留上下文批准" : choice.detail}</span>
    </button>)}
    <p className="plan-popover-hint">记住上次选择，作为下次主按钮</p>
  </div>;
}

/** 正式提案后才挂载；模型选择仅随批准生效。 */
export function PlanPanel({ plan, catalog, onCatalog, onError, onRefine }: {
  plan: PlanController; catalog?: NativeModelSnapshot;
  onCatalog: () => Promise<void>; onError: (error: unknown) => void; onRefine: () => void;
}) {
  const [selection, setSelection] = useState<PlanSnapshot["executionModel"]>();
  const [popover, setPopover] = useState<"model" | "choice">();
  const [dismissed, setDismissed] = useState<string>();
  const [remembered, setRemembered] = useState<ActionChoice>(() => {
    try { const value = localStorage.getItem("omp-desktop.plan-choice"); return choices.find((choice) => choice.id === value)?.id ?? "compact"; }
    catch { return "compact"; }
  });
  const body = useRef<HTMLDivElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const choiceTrigger = useRef<HTMLButtonElement>(null);
  const initialized = useRef("");
  const snapshot = plan.snapshot;
  const documentKey = `${snapshot?.identity.epoch}:${snapshot?.document?.path}:${plan.reloadNonce}`;
  const toc = usePlanToc(body, documentKey);
  useEffect(() => { void onCatalog().catch(onError); }, []);
  useEffect(() => {
    if (!snapshot?.reviewId || initialized.current === snapshot.reviewId || !catalog) return;
    if (initialized.current && snapshot.operation?.status === "failed") { initialized.current = snapshot.reviewId; return; }
    initialized.current = snapshot.reviewId;
    const role = catalog.roles.find((item) => item.role === "default");
    const roleModel = catalog.models.find((item) => item.selector === role?.resolvedSelector && (!item.kind || item.kind === "chat"));
    const previous = snapshot.executionModel;
    const fallback = catalog.models.find((item) => item.provider === previous?.provider && item.id === previous?.modelId) ?? catalog.models.find((item) => item.selector === catalog.currentSelector);
    const model = roleModel ?? fallback;
    setSelection(model ? { provider: model.provider, modelId: model.id, thinkingLevel: roleModel ? role?.thinkingLevel : previous?.thinkingLevel } : undefined);
  }, [catalog, snapshot?.reviewId]);
  const applying = snapshot?.phase === "applying";
  const readonly = !plan.connected || snapshot?.busy || applying || snapshot?.phase !== "review";
  useEffect(() => { if (readonly || !plan.visible) setPopover(undefined); }, [readonly, plan.visible]);
  if (!snapshot?.document) return null;
  const model = catalog?.models.find((item) => item.provider === selection?.provider && item.id === selection.modelId);
  const percent = snapshot.context && model?.contextWindow ? snapshot.context.tokens / model.contextWindow * 100 : undefined;
  const disabled = (choice: ActionChoice) => Boolean(readonly || (choice !== "save" && (!model || (model.kind && model.kind !== "chat") || catalog?.providers.find((item) => item.id === model.provider)?.locked || (choice === "keep" && percent !== undefined && percent > 95))));
  const primary = choices.find((choice) => choice.id === (disabled(remembered) ? "compact" : remembered))!;
  const run = (choice: ActionChoice) => {
    if (disabled(choice)) return;
    void plan.decide(choice, selection, undefined, model?.name || model?.id).catch((failure) => {
      if (!(failure instanceof NotifiedPlanError)) onError(failure);
    });
  };
  const close = () => setPopover(undefined);
  const operationError = (snapshot.operation?.status === "failed" || snapshot.operation?.status === "cancelled") && snapshot.operation.error;
  const error = plan.error || (operationError && snapshot.error?.startsWith(operationError) ? undefined : snapshot.error);
  const phase = applying ? "正在执行" : snapshot.phase === "review" ? "待审阅" : snapshot.phase === "planning" ? "规划中" : snapshot.phase === "paused" ? "已暂停" : "已结束";
  return <aside className="plan-pane" aria-label="原生计划审阅" hidden={!plan.visible} onKeyDown={(event) => {
    if (readonly) return;
    if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) setPopover("choice"); else run(primary.id); }
    if (event.altKey && event.key.toLowerCase() === "m") { event.preventDefault(); event.stopPropagation(); setPopover("model"); }
  }}>
    <PaneResizeHandle storageKey="omp-desktop.plan-width" label="调整计划侧栏宽度" initialWidth={560} minWidth={280} reserve={260} />
    <header className="plan-header">
      <div className="plan-heading"><h2>计划</h2><span>· {phase} · {plan.saving ? "正在保存…" : plan.dirty ? "未保存" : "已保存"}</span></div>
      <PlanToc {...toc} variant="dropdown" />
      <button type="button" aria-label="重新加载计划" title="重新加载磁盘版本" disabled={!plan.conflict} onClick={plan.reload}>⟳</button>
      <button type="button" aria-label="收起计划" onClick={plan.hide}>×</button>
    </header>
    {(plan.conflict || (error && error !== dismissed)) && <div className="plan-banner" role="alert">
      <span title={plan.conflict ? "磁盘版本已变化，当前修改仍保留" : error}>{plan.conflict ? "磁盘版本已变化，当前修改仍保留" : error}</span>
      {plan.conflict ? <><button type="button" onClick={() => { void window.desktop.copyText(plan.editor.current?.flush() ?? plan.value).catch(onError); }}>保留并复制</button><button type="button" onClick={plan.reload}>重新加载</button></> : <button type="button" aria-label="关闭计划错误" onClick={() => setDismissed(error)}>×</button>}
    </div>}
    <div className="plan-body">
      <PlanToc {...toc} variant="rail" />
      <div className="plan-document" ref={body}><Suspense fallback={<p role="status">正在加载计划编辑器…</p>}><PlanEditor ref={plan.editor} documentKey={documentKey} value={plan.value} readOnly={readonly} onDirty={plan.onDirty} onChange={plan.onChange} onSave={() => { void plan.flush().catch(onError); }} /></Suspense></div>
    </div>
    <footer className="plan-bar">
      {applying ? <><span className="plan-applying" role="status">⟳ 正在执行计划…</span><button type="button" className="stop-button" onClick={() => { void window.desktop.request({ type: "abort" }).catch(onError); }}>■ 停止</button></> : <>
        <button type="button" ref={modelTrigger} className="plan-model-trigger" aria-label="选择执行模型" aria-expanded={popover === "model"} aria-haspopup="dialog" disabled={readonly} title={`${model?.name || selection?.modelId || "请选择执行模型"} · 思考:${selection?.thinkingLevel ?? "继承"}（Alt+M）`} onClick={() => setPopover(popover === "model" ? undefined : "model")}><span>⚙ {model?.name || selection?.modelId || "选择模型"}{model?.reasoning ? ` · 思考:${selection?.thinkingLevel ?? "继承"}` : ""}</span> ▾</button>
        <div className={`plan-context${percent !== undefined && percent > 95 ? " is-danger" : ""}`} title={`${snapshot.context?.tokens.toLocaleString() ?? "未知"} / ${model?.contextWindow?.toLocaleString() ?? "未知窗口"} tokens`}>
          <span className="plan-context-label">上下文</span><span className="plan-context-track" role="progressbar" aria-label="执行模型上下文用量" aria-valuenow={percent === undefined ? undefined : Math.min(100, percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} /></span><span>{percent === undefined ? "未知" : `${percent.toFixed(1)}%`}</span>
        </div>
        <button type="button" className="plan-refine" disabled={readonly} onClick={onRefine}>继续完善</button>
        <div className="plan-split"><button type="button" className="plan-primary-action" disabled={disabled(primary.id)} title={`${primary.detail}（Ctrl+Enter）`} onClick={() => run(primary.id)}>{primary.label}</button><button type="button" ref={choiceTrigger} aria-label="选择计划处置方式" aria-expanded={popover === "choice"} aria-haspopup="menu" disabled={readonly} title="选择计划处置方式（Ctrl+Shift+Enter）" onClick={() => setPopover(popover === "choice" ? undefined : "choice")}>▾</button></div>
        {popover === "model" && <PlanModelPicker catalog={catalog} selection={selection} onChange={setSelection} onClose={close} trigger={modelTrigger} />}
        {popover === "choice" && <ChoiceMenu current={primary.id} disabled={disabled} trigger={choiceTrigger} onClose={close} onChoose={(choice) => { setRemembered(choice); try { localStorage.setItem("omp-desktop.plan-choice", choice); } catch { /* 存储禁用时仍保留当前窗口选择。 */ } close(); choiceTrigger.current?.focus(); run(choice); }} />}
      </>}
    </footer>
  </aside>;
}
