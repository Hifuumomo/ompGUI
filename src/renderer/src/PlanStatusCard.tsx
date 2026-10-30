import { useState } from "react";
import type { PlanStatusRecord, PlanStatusText } from "../../shared/plan-status";
import { planStatusText } from "../../shared/plan-status";
import { RichContent } from "./RichContent";
import "./plan-status-card.css";

export interface PlanStatusCardProps {
  record?: PlanStatusRecord;
  path?: string;
  markdown?: string;
  timestamp?: number;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  onOpenSession?: (sessionId: string) => Promise<void>;
}

/** 只读处置快照；折叠按钮与导航、复制按钮相互独立。 */
export function PlanStatusCard({ record, path, markdown, timestamp, expanded, defaultExpanded = false, onToggle, onOpenSession }: PlanStatusCardProps) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const [actionError, setActionError] = useState<string>();
  const open = expanded ?? localExpanded;
  const model = record?.model;
  const text: PlanStatusText = record ? planStatusText(record, model?.name ?? model?.modelId) : { title: "计划已批准", level: "success" };
  const document = markdown ?? (record?.kind === "refined" || record?.kind === "compactCancelled" ? record.document : undefined);
  const error = record?.kind === "failed" ? record.error || text.detail : undefined;
  const hasBody = !!(document?.trim() || error?.trim());
  const planPath = path ?? record?.planPath;
  const metadata = [
    record?.revision !== undefined ? `第 ${record.revision} 版` : undefined,
    model ? `${model.name ?? model.modelId} 执行` : undefined,
    model?.thinkingLevel ? `思考:${model.thinkingLevel}` : undefined,
    record?.contextPercent !== undefined ? `上下文 ${record.contextPercent}%` : undefined,
    record?.sourceSessionFile ? `来自 ${record.sourceSessionFile}` : undefined,
    record?.kind === "failed" ? "展开查看完整错误"
      : record?.kind === "refined" || record?.kind === "saved" || record?.kind === "stopped" || record?.kind === "compactCancelled" ? text.detail : undefined,
  ].filter(Boolean).join(" · ");
  const time = timestamp !== undefined && Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
  const heading = <>
    {hasBody && <span className="plan-status-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>}
    <span className="plan-status-icon" aria-hidden="true">{text.level === "error" ? "×" : text.level === "warning" ? "⚠" : text.level === "info" ? "↩" : "✓"}</span>
    <strong>{text.title}</strong>
    {metadata && <span className="plan-status-metadata">{metadata}</span>}
    <span className="plan-status-location">
      {planPath && <code>{planPath}</code>}
      {time && <time dateTime={time.toISOString()}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>}
    </span>
  </>;
  /** 操作失败在卡片内保留真实错误，不触发折叠或吞掉拒绝。 */
  async function act(action: () => Promise<void>) {
    setActionError(undefined);
    try { await action(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <article className={`conversation-message plan-status-card plan-status-${text.level}`} aria-label={text.title} data-plan-kind={record?.kind ?? "approved"}>
    <div className="plan-status-header conversation-heading">
      {hasBody ? <button type="button" className="plan-status-toggle" aria-expanded={open} onClick={() => {
        setLocalExpanded(!open);
        onToggle?.(!open);
      }}>{heading}</button> : <div className="plan-status-summary">{heading}</div>}
      {(record?.savedPath || (record?.targetSessionId && onOpenSession)) && <div className="plan-status-actions">
        {record.savedPath && <button type="button" onClick={() => { void act(() => window.desktop.copyText(record.savedPath!)); }}>复制路径</button>}
        {record.targetSessionId && onOpenSession && <button type="button" onClick={() => { void act(() => onOpenSession(record.targetSessionId!)); }}>打开新会话 →</button>}
      </div>}
    </div>
    {hasBody && open && <div className="plan-status-body">{error ? <pre>{error}</pre> : <RichContent text={document!} />}</div>}
    {hasBody && open && <div className="plan-status-footer">{record?.revision !== undefined && `第 ${record.revision} 版 · `}{error ? "只读 · 完整错误详情" : "只读 · 内容为处置时的计划快照"}</div>}
    {actionError && <p className="inline-error" role="alert">{actionError}</p>}
  </article>;
}
