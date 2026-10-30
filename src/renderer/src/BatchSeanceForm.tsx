import { useEffect, useId, useRef, useState } from "react";
import type { ModelInfo, SeanceBatchItem, SeanceConsultation, SeanceSource, SessionSummary } from "../../shared/protocol";

interface BatchSeanceFormProps {
  sessions: readonly SessionSummary[];
  onInspect: (source: string) => Promise<SeanceSource>;
  onModels: () => Promise<ModelInfo[]>;
  onLaunch: (requests: readonly SeanceConsultation[]) => Promise<SeanceBatchItem[]>;
  onCancel: () => void;
}

type SourceStatus = "loading" | "inspect-error" | "ready" | "launching" | "running" | "completed" | "launch-error";
interface SourceChoice {
  session: SessionSummary;
  source?: SeanceSource;
  choice: "saved" | "other";
  model: string;
  status: SourceStatus;
  error?: string;
}

/** 来源集合变更即隔离旧表单，迟到的解析与启动结果不能污染新选择。 */
export function BatchSeanceForm(props: BatchSeanceFormProps) {
  return <BatchSeanceChoices key={JSON.stringify(props.sessions.map((session) => session.path))} {...props} />;
}

/** 每个来源独立选择模型，成功启动后始终保留结果且不再提交。 */
function BatchSeanceChoices(props: BatchSeanceFormProps) {
  const [entries, setEntries] = useState<SourceChoice[]>(() => props.sessions.map((session) => ({
    session, choice: "saved", model: "", status: "loading",
  })));
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState("");
  const [pending, setPending] = useState(false);
  const active = useRef(false);
  const launching = useRef(false);
  const callbacks = useRef(props);
  const generation = useRef(0);
  callbacks.current = props;
  const modelList = useId();

  function update(path: string, change: Partial<SourceChoice>) {
    if (active.current) setEntries((items) => items.map((item) => item.session.path === path ? { ...item, ...change } : item));
  }

  async function inspect(path: string) {
    const token = generation.current;
    try {
      const source = await callbacks.current.onInspect(path);
      if (!active.current || token !== generation.current) return;
      update(path, { source, status: "ready", choice: source.modelSelectors.length ? "saved" : "other", error: undefined });
    } catch (failure) {
      if (!active.current || token !== generation.current) return;
      update(path, { status: "inspect-error", error: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  useEffect(() => {
    active.current = true;
    const token = ++generation.current;
    // 外层按来源路径隔离生命周期；回调引用变化不重复解析或清空用户的模型选择。
    for (const session of callbacks.current.sessions) void inspect(session.path);
    void callbacks.current.onModels().then((available) => {
      if (active.current && token === generation.current) setModels(available);
    }).catch((failure: unknown) => {
      if (active.current && token === generation.current) setModelError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { active.current = false; generation.current++; };
  }, []);

  const ready = entries.filter((entry) => (entry.status === "ready" || entry.status === "launch-error")
    && entry.source && (entry.choice === "saved" || entry.model.trim()));
  const busy = pending || entries.some((entry) => entry.status === "loading");
  const missingModel = entries.some((entry) => (entry.status === "ready" || entry.status === "launch-error")
    && entry.choice === "other" && !entry.model.trim());
  const successful = entries.filter((entry) => entry.status === "running" || entry.status === "completed").length;

  /** 单次批量请求同时启动所有就绪项；重试不会包含已成功启动的来源。 */
  async function launch() {
    if (launching.current || busy || missingModel || !ready.length) return;
    launching.current = true;
    setPending(true);
    const requests = ready.map((entry): SeanceConsultation => ({
      sourceSession: entry.source!.path,
      ...(entry.choice === "other" ? { model: entry.model.trim() } : {}),
    }));
    const token = generation.current;
    for (const entry of ready) update(entry.session.path, { status: "launching", error: undefined });
    let results: SeanceBatchItem[];
    try {
      results = await callbacks.current.onLaunch(requests);
    } catch (failure) {
      results = requests.map((request) => ({ sourceSession: request.sourceSession, error: failure instanceof Error ? failure.message : String(failure) }));
    }
    if (!active.current || token !== generation.current) return;
    ready.forEach((entry, index) => {
      const result = results.find((item) => item.sourceSession === requests[index].sourceSession);
      if (result?.launch && result.error === undefined) {
        update(entry.session.path, { status: result.launch.state, error: undefined });
      } else {
        update(entry.session.path, { status: "launch-error", error: result?.error ?? "未收到启动结果，请重试。" });
      }
    });
    launching.current = false;
    setPending(false);
  }

  return <form className="modal-body" onSubmit={(event) => { event.preventDefault(); void launch(); }}>
    <p>为所选 {entries.length} 个历史会话分别并行派生只读 /seance 子代理，不恢复、不改写源会话。</p>
    <p>所有结果写入当前打开的会话，而不是各来源会话；运行和结果可在子代理活动中查看。</p>
    {modelError && <p role="alert">可用模型列表读取失败：{modelError}。仍可手动输入模型 selector。</p>}
    {entries.map((entry, index) => {
      const fixed = pending || entry.status === "running" || entry.status === "completed";
      const name = entry.session.title || "未命名会话";
      return <fieldset key={entry.session.path} disabled={fixed}>
        <legend>{name}</legend>
        <p className="muted" style={{ overflowWrap: "anywhere" }}>{entry.session.path}</p>
        {entry.status === "loading" && <p role="status">正在读取源会话…</p>}
        {entry.source && <>
          <label className="ask-option"><input type="radio" name={`${modelList}-${index}`} checked={entry.choice === "saved"}
            disabled={fixed || !entry.source.modelSelectors.length} onChange={() => update(entry.session.path, { choice: "saved" })} />
            <span>使用源会话保存的模型{entry.source.modelSelectors.length ? `：${entry.source.modelSelectors.join(" → ")}` : "（未保存，请选择其他模型）"}</span>
          </label>
          <label className="ask-option"><input type="radio" name={`${modelList}-${index}`} checked={entry.choice === "other"}
            onChange={() => update(entry.session.path, { choice: "other" })} /><span>选择其他模型（仅本次）</span></label>
          {entry.choice === "other" && <input aria-label={`${name} 的 Seance 模型`} list={modelList} value={entry.model}
            placeholder="provider/model 或原生模型 selector" onChange={(event) => update(entry.session.path, { model: event.target.value })} />}
        </>}
        {entry.status === "ready" && <p role="status">{entry.choice === "other" && !entry.model.trim() ? "请选择模型后才能启动" : "待启动"}</p>}
        {entry.status === "launching" && <p role="status">正在启动咨询…</p>}
        {entry.status === "running" && <p role="status">已启动，运行状态见子代理活动</p>}
        {entry.status === "completed" && <p role="status">咨询已完成</p>}
        {entry.error && <p role="alert">{name}：{entry.error}</p>}
        {entry.status === "inspect-error" && <button type="button" onClick={() => {
          update(entry.session.path, { status: "loading", error: undefined });
          void inspect(entry.session.path);
        }}>重新读取源会话</button>}
      </fieldset>;
    })}
    <datalist id={modelList}>{models.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.name}</option>)}</datalist>
    <p className="muted">确认后会调用模型并计费用量。每个来源独立使用所选模型；取消此窗口不会启动尚未提交的咨询，也不会停止已启动的咨询。</p>
    {successful > 0 && <p role="status">已成功启动 {successful} 个咨询；这些来源不会再次启动。</p>}
    <div className="action-row">
      <button type="button" disabled={pending} onClick={props.onCancel}>{successful ? "关闭" : "取消"}</button>
      <button type="submit" className="primary" disabled={busy || missingModel || !ready.length}>
        {pending ? "正在启动咨询…" : entries.some((entry) => entry.status === "launch-error") ? "重试失败项并启动就绪咨询" : "并行开始咨询"}
      </button>
    </div>
  </form>;
}
