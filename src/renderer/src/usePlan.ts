import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanAction, PlanChoice, PlanFeedbackImage, PlanPhase, PlanSnapshot } from "../../shared/native-plan";
import type { PlanEditorHandle } from "./PlanEditor";
import type { RefObject } from "react";
import type { ToastNotice } from "./Toasts";
import { planStatusText } from "../../shared/plan-status";
import type { PlanStatusRecord } from "../../shared/plan-status";

/** 计划侧栏与主输入框共享的草稿、保存和处置契约。 */
export interface PlanController {
  snapshot?: PlanSnapshot;
  value: string;
  visible: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict?: PlanSnapshot;
  editor: RefObject<PlanEditorHandle | null>;
  reloadNonce: number;
  connected: boolean;
  onDirty: () => void;
  onChange: (value: string) => void;
  status: () => Promise<PlanSnapshot | null>;
  act: (action: PlanAction) => Promise<PlanSnapshot | null>;
  decide: (choice: PlanChoice, executionModel?: PlanSnapshot["executionModel"], feedback?: string, modelLabel?: string, feedbackImages?: PlanFeedbackImage[]) => Promise<PlanSnapshot | null | undefined>;
  flush: () => Promise<void>;
  protect: () => Promise<boolean>;
  hide: () => void;
  show: () => void;
  reload: () => void;
}

const CONFLICT = "计划已在磁盘修改，请先处理冲突";
type ExecutionModel = NonNullable<PlanSnapshot["executionModel"]>;

/** 已由计划终态通知呈现的失败，调用方不再重复显示连接错误。 */
export class NotifiedPlanError extends Error {}

/** 终态文案依据真实阶段区分恢复审阅和已退出计划模式的取消。 */
export function planNotice(operation: NonNullable<PlanSnapshot["operation"]>, modelLabel: string, phase: PlanPhase): ToastNotice | undefined {
  if (operation.status === "running") return undefined;
  const kind: PlanStatusRecord["kind"] = operation.status === "failed" ? "failed"
    : operation.status === "cancelled" ? operation.choice === "compact" && phase === "off" ? "compactCancelled" : "stopped"
    : operation.choice === "refine" ? "refined"
    : operation.choice === "save" ? "saved"
    : operation.choice === "execute" ? "continued" : "approved";
  const text = planStatusText({ kind, choice: operation.choice, savedPath: operation.savedPath, error: operation.error }, modelLabel, phase);
  if (kind === "failed") return { ...text, title: `${text.title}：${text.detail}` };
  if (kind === "stopped" && phase === "review") return { ...text, title: `${text.title}，${text.detail}` };
  return text;
}

/** 计划草稿独立于聊天草稿；所有保存和处置共用一个版本与保存队列。 */
export function usePlan(options: { connected: boolean; sessionId?: string; sessionFile?: string; blocked: boolean; onOpen: () => void; onTransition: () => Promise<void>; onError: (error: unknown) => void; onNotice: (notice: ToastNotice) => void }): PlanController {
  const [snapshot, setSnapshot] = useState<PlanSnapshot>();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<PlanSnapshot>();
  const [editTick, setEditTick] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const editor = useRef<PlanEditorHandle>(null);
  const state = useRef<PlanSnapshot | undefined>(undefined);
  const text = useRef("");
  const changed = useRef(false);
  const editVersion = useRef(0);
  const savingRef = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingOpen = useRef<string | undefined>(undefined);
  const completed = useRef(new Set<string>());
  const executionLabel = useRef<{ epoch: string; modelKey: string; label: string } | undefined>(undefined);
  const statusRequest = useRef(0);
  const latest = useRef(options); latest.current = options;

  const adopt = useCallback((next: PlanSnapshot, explicit = false) => {
    const old = state.current;
    if (old?.operation?.id && old.operation.id === next.operation?.id && old.operation.status !== "running" && next.operation.status === "running") return;
    const current = latest.current;
    const migration = old?.operation?.status === "running" && next.operation?.id === old.operation.id && next.operation.origin.epoch === old.identity.epoch;
    if (!explicit && old && old.identity.epoch !== next.identity.epoch && !migration) return;
    if (!explicit && current.sessionId && next.identity.sessionId !== current.sessionId && !migration) return;
    const newDocument = old?.identity.epoch !== next.identity.epoch || old?.document?.path !== next.document?.path;
    if (newDocument && changed.current && old?.identity.sessionId === next.identity.sessionId) {
      // 重连只接收磁盘基线，不覆盖断线期间保留的文本。
      if (old.document?.revision !== next.document?.revision) setConflict(next);
    } else if (newDocument || !changed.current) {
      text.current = next.document?.content ?? "";
      setValue(text.current);
    }
    state.current = next; setSnapshot(next);
    // 处置失败归通知条；保存和冲突错误仍归侧栏横幅。
    const operationError = (next.operation?.status === "failed" || next.operation?.status === "cancelled") && next.operation.error;
    if (next.error && !(operationError && next.error.startsWith(operationError))) setError(next.error);
    if (next.phase === "review" && next.reviewId !== old?.reviewId) pendingOpen.current = next.reviewId;
    if (next.phase !== "review" && next.phase !== "applying") { setVisible(false); pendingOpen.current = undefined; }
    if (next.operation && next.operation.status !== "running" && !completed.current.has(next.operation.id)) {
      completed.current.add(next.operation.id);
      const modelKey = next.executionModel ? `${next.executionModel.provider}/${next.executionModel.modelId}` : "";
      const selected = executionLabel.current;
      const label = selected?.epoch === next.operation.origin.epoch && (!modelKey || modelKey === selected.modelKey) ? selected.label : modelKey || "当前模型";
      const notice = planNotice(next.operation, label, next.phase);
      if (notice) {
        const savedPath = next.operation.status === "completed" && next.operation.choice === "save" ? next.operation.savedPath : undefined;
        if (savedPath) notice.action = { label: "复制路径", run: async () => {
          try { await window.desktop.copyText(savedPath); }
          catch (failure) { latest.current.onNotice({ level: "error", title: `复制路径失败：${failure instanceof Error ? failure.message : String(failure)}` }); }
        } };
        latest.current.onNotice(notice);
      }
      void latest.current.onTransition().catch(latest.current.onError);
    }
  }, []);

  const status = useCallback(async () => {
    const request = ++statusRequest.current;
    const { sessionId, sessionFile } = latest.current;
    const next = await window.desktop.plan({ op: "status" });
    if (next && request === statusRequest.current && latest.current.connected &&
        latest.current.sessionId === sessionId && latest.current.sessionFile === sessionFile)
      adopt(next, true);
    return next;
  }, [adopt]);

  useEffect(() => window.desktop.onFrame((frame) => {
    if (frame.type === "plan_state" && latest.current.connected) adopt(frame.snapshot as PlanSnapshot);
  }), [adopt]);
  useEffect(() => {
    if (!options.connected) { setVisible(false); return; }
    void status().catch(options.onError);
  }, [options.connected, options.sessionId, options.sessionFile, status]);
  useEffect(() => {
    if (options.blocked || !options.connected || !pendingOpen.current || snapshot?.reviewId !== pendingOpen.current) return;
    pendingOpen.current = undefined;
    latest.current.onOpen(); setVisible(true);
  }, [options.blocked, options.connected, snapshot]);

  const updateDirty = useCallback((next: boolean) => {
    changed.current = next;
    // 原生关闭可早于下一次 React effect；编辑事务立即撤销关闭许可。
    window.desktop.setPlanDirty(next || savingRef.current);
    setDirty(next);
  }, []);
  const onDirty = useCallback(() => { editVersion.current++; setEditTick(editVersion.current); updateDirty(true); }, [updateDirty]);
  const onChange = useCallback((next: string) => {
    text.current = next; setValue(next);
    updateDirty(next !== state.current?.document?.content);
  }, [updateDirty]);

  const save = useCallback(async () => {
    const run = async () => {
      const current = state.current;
      if (!current?.document || !changed.current) return;
      if (!latest.current.connected) throw new Error("连接已断开，计划修改已保留，请重连后保存");
      if (current.phase !== "review") throw new Error("计划当前不可编辑");
      if (current.error === CONFLICT) throw new Error(CONFLICT);
      const version = editVersion.current, content = text.current;
      setSaving(true);
      savingRef.current = true;
      window.desktop.setPlanDirty(true);
      try {
        const next = await window.desktop.plan({ op: "saveDocument", identity: current.identity, path: current.document.path, revision: current.document.revision, content });
        if (!next || state.current?.identity.epoch !== current.identity.epoch) return;
        if (next.error === CONFLICT) { setConflict(next); setError(CONFLICT); throw new Error(CONFLICT); }
        state.current = next; setSnapshot(next); setError("");
        if (version === editVersion.current && text.current === content) updateDirty(false);
      } finally { savingRef.current = false; setSaving(false); window.desktop.setPlanDirty(changed.current); }
    };
    const result = queue.current.then(run).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; });
    queue.current = result.catch(() => {});
    return result;
  }, [updateDirty]);
  const flush = useCallback(async () => {
    try {
      const next = editor.current?.flush();
      if (next !== undefined) { text.current = next; setValue(next); updateDirty(next !== state.current?.document?.content); }
      await save();
      if (conflict) throw new Error(CONFLICT);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [save, conflict, updateDirty]);
  useEffect(() => {
    if (!dirty || !options.connected || snapshot?.phase !== "review" || conflict) return;
    const timer = setTimeout(() => { void flush().catch((cause) => setError(String(cause instanceof Error ? cause.message : cause))); }, 600);
    return () => clearTimeout(timer);
  }, [value, editTick, dirty, options.connected, snapshot?.phase, conflict, flush]);

  const protect = useCallback(async (): Promise<boolean> => {
    if (state.current?.operation?.status === "running") throw new Error("计划正在转换，请先停止或等待完成");
    if (!changed.current) return true;
    try { await flush(); return true; }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (window.confirm("计划尚未保存。重试保存？（取消后可选择放弃更改）")) {
        try { await flush(); return true; } catch (retry) { latest.current.onError(retry); return false; }
      }
      if (!window.confirm("放弃未保存的计划修改？此操作不可撤销。")) return false;
      updateDirty(false); setConflict(undefined); return true;
    }
  }, [flush, updateDirty]);
  useEffect(() => { window.desktop.setPlanDirty(dirty || saving); }, [dirty, saving]);
  useEffect(() => window.desktop.onPlanCloseRequest((id) => { void protect().then((allow) => window.desktop.respondPlanClose(id, allow)).catch((cause) => { window.desktop.respondPlanClose(id, false); latest.current.onError(cause); }); }), [protect]);

  const act = useCallback(async (action: PlanAction) => {
    try { const next = await window.desktop.plan(action); if (next) adopt(next, true); return next; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
  }, [adopt]);
  const decide = useCallback(async (choice: PlanChoice, executionModel?: ExecutionModel, feedback?: string, modelLabel?: string, feedbackImages?: PlanFeedbackImage[]) => {
    await flush();
    const current = state.current;
    if (!current?.reviewId || !current.document || current.phase !== "review") throw new Error("当前没有待审阅的计划");
    setError("");
    executionLabel.current = { epoch: current.identity.epoch, modelKey: executionModel ? `${executionModel.provider}/${executionModel.modelId}` : "", label: modelLabel || (executionModel ? `${executionModel.provider}/${executionModel.modelId}` : "当前模型") };
    let result = await act({ op: "decide", identity: current.identity, reviewId: current.reviewId, revision: current.document.revision, choice, executionModel, feedback,
      ...(feedbackImages?.length ? { feedbackImages } : {}) });
    // 完善意见由原生处置派发；终态 completed 表示规划回合已被接收，而非仅已退回。
    if (choice === "refine" && result?.operation?.status === "running") {
      const operationId = result.operation.id;
      if (state.current?.operation?.id === operationId && state.current.operation.status !== "running") {
        if (state.current.operation.status === "completed") return state.current;
        throw new NotifiedPlanError(state.current.operation.error ?? "计划完善已取消");
      }
      result = await new Promise<PlanSnapshot>((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("计划完善操作未完成，请检查连接状态")); }, 30_000);
        const unsubscribe = window.desktop.onFrame((frame) => {
          if (frame.type !== "plan_state") return;
          const next = frame.snapshot as PlanSnapshot;
          if (next.operation?.id !== operationId || next.operation.status === "running") return;
          clearTimeout(timer); unsubscribe();
          if (next.operation.status === "completed") resolve(next); else reject(new NotifiedPlanError(next.operation.error ?? "计划完善已取消"));
        });
      });
    }
    if (choice === "refine" && result?.operation && result.operation.status !== "completed") throw new NotifiedPlanError(result.operation.error ?? "计划完善已取消");
    return result;
  }, [flush, act]);
  const hide = useCallback(() => { pendingOpen.current = undefined; setVisible(false); }, []);
  const show = useCallback(() => { if (state.current?.document && ["review", "applying"].includes(state.current.phase)) { pendingOpen.current = undefined; latest.current.onOpen(); setVisible(true); } }, []);
  const reload = useCallback(() => {
    if (!conflict?.document || !window.confirm("重新加载磁盘版本并放弃当前修改？")) return;
    state.current = { ...conflict, error: undefined }; setSnapshot(state.current);
    text.current = conflict.document.content; setValue(text.current); updateDirty(false); setConflict(undefined); setError("");
    setReloadNonce((current) => current + 1);
  }, [conflict, updateDirty]);
  return { snapshot, value, visible, dirty, saving, error, conflict, editor, reloadNonce, connected: options.connected, onDirty, onChange, status, act, decide, flush, protect, hide, show, reload };
}
