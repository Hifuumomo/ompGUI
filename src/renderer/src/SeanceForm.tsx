import { useEffect, useId, useRef, useState } from "react";
import type { ModelInfo, SeanceSource, SessionSummary } from "../../shared/protocol";

interface Props {
  sessions: readonly SessionSummary[];
  initialSource?: string;
  initialModel?: string;
  onInspect: (source: string) => Promise<SeanceSource>;
  onModels: () => Promise<ModelInfo[]>;
  onLaunch: (source: string, model?: string) => Promise<void>;
  onCancel: () => void;
}

/** 咨询历史而非恢复源会话；模型选择只应用于本次只读子代理。 */
export function SeanceForm(props: Props) {
  const [selector, setSelector] = useState(props.initialSource ?? "");
  const [source, setSource] = useState<SeanceSource>();
  const [choice, setChoice] = useState(props.initialModel ? "other" : "saved");
  const [model, setModel] = useState(props.initialModel ?? "");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(Boolean(props.initialSource?.trim()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const modelList = useId();
  const inspect = props.onInspect;
  const loadModels = props.onModels;

  useEffect(() => {
    const token = ++sequence.current;
    if (!selector.trim()) return;
    const timer = setTimeout(() => {
      void Promise.all([inspect(selector.trim()), loadModels()]).then(([result, available]) => {
        if (token !== sequence.current) return;
        setSource(result);
        setModels(available);
        if (!result.modelSelectors.length) setChoice("other");
        setLoading(false);
      }).catch((failure: unknown) => {
        if (token !== sequence.current) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setLoading(false);
      });
    }, 200);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [selector, inspect, loadModels]);

  /** 编辑立即撤销旧解析结果，不在每次输入后的同步 effect 中重复派生状态。 */
  function changeSource(value: string) {
    sequence.current++;
    setSelector(value);
    setSource(undefined);
    setError("");
    setLoading(Boolean(value.trim()));
  }

  return (
    <form className="modal-body" onSubmit={(event) => {
      event.preventDefault();
      if (!source || pending || (choice === "other" && !model.trim())) return;
      setPending(true);
      setError("");
      void props.onLaunch(source.path, choice === "other" ? model.trim() : undefined).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
        setPending(false);
      });
    }}>
      <p>派生只读 seance 子代理，索引源会话的主题、决策与未解决问题，结果写入当前会话；不恢复、不改写源会话。</p>
      <label>选择历史会话
        <select aria-label="选择 Seance 源会话" disabled={pending}
          value={props.sessions.some((session) => session.path === selector) ? selector : ""}
          onChange={(event) => changeSource(event.target.value)}>
          <option value="">手动输入会话 ID 或路径</option>
          {props.sessions.map((session) => <option key={session.path} value={session.path}>
            {session.title} · {session.cwd}
          </option>)}
        </select>
      </label>
      <label>源会话 ID 或 JSONL 路径
        <input aria-label="Seance 源会话" value={selector} disabled={pending}
          placeholder="选择历史会话，或输入会话 ID／绝对路径"
          onChange={(event) => changeSource(event.target.value)} />
      </label>
      {loading && <p role="status">正在读取源会话及可用模型…</p>}
      {source && <>
        <p className="muted" style={{overflowWrap:"anywhere"}}>{source.path}</p>
        <fieldset disabled={pending}>
          <legend>咨询模型（仅本次）</legend>
          <label className="ask-option"><input type="radio" name={modelList} checked={choice === "saved"}
            disabled={!source.modelSelectors.length} onChange={() => setChoice("saved")} />
            <span>使用源会话保存的模型{source.modelSelectors.length ? `：${source.modelSelectors.join(" → ")}` : "（未保存，请选择其他模型）"}</span>
          </label>
          <label className="ask-option"><input type="radio" name={modelList} checked={choice === "other"}
            onChange={() => setChoice("other")} /><span>选择其他模型</span></label>
          {choice === "other" && <>
            <input aria-label="Seance 模型" list={modelList} value={model}
              placeholder="provider/model 或原生模型 selector"
              onChange={(event) => setModel(event.target.value)} />
            <datalist id={modelList}>{models.map((item) => (
              <option key={`${item.provider}/${item.id}`} value={`${item.provider}/${item.id}`}>{item.name}</option>
            ))}</datalist>
          </>}
        </fieldset>
      </>}
      <p className="muted">会调用模型并计费用量；运行和结果可在子代理活动中查看。取消此窗口不会启动咨询。</p>
      {error && <p role="alert">{error}</p>}
      <div className="action-row">
        <button type="button" disabled={pending} onClick={props.onCancel}>取消</button>
        <button type="submit" className="primary" disabled={pending || loading || !source || (choice === "other" && !model.trim())}>
          {pending ? "正在启动咨询…" : "开始咨询"}
        </button>
      </div>
    </form>
  );
}
