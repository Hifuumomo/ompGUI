import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type {
  SubagentSnapshot,
  SubagentTranscriptResult,
  SubagentTransport,
} from "../../shared/subagents";
import type { TimelineMessage } from "./session";
import { Transcript } from "./Transcript";

const TRANSCRIPT_REFRESH_MS = 1000;
function useTranscript(
  transport: SubagentTransport,
  agent: SubagentSnapshot,
  sessionId?: string,
) {
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!agent.sessionFile) {
      setLoading(false);
      return;
    }
    return observeTranscript({
      transport,
      agent,
      sessionId,
      setMessages,
      setError,
      setLoading,
    });
  }, [
    transport,
    agent.id,
    agent.sessionFile,
    agent.status,
    agent.historical,
    sessionId,
    revision,
  ]);
  return {
    messages,
    error,
    loading,
    retry: () => setRevision((value) => value + 1),
  };
}

export function SubagentTranscript({
  agent,
  transport,
  sessionId,
}: {
  readonly agent: SubagentSnapshot;
  readonly transport: SubagentTransport;
  readonly sessionId?: string;
}) {
  const state = useTranscript(transport, agent, sessionId);
  return (
    <section
      className="subagent-transcript"
      aria-label={`${agent.agent} 的对话`}
    >
      <p className="subagent-note">
        已保存对话 · 运行期间每秒增量读取；尚未落盘的输出可在代理详情查看。
      </p>
      {state.error && (
        <p role="alert">
          {state.error} <button onClick={state.retry}>重试</button>
        </p>
      )}
      {state.loading && <p role="status">正在读取原生对话…</p>}
      {!agent.sessionFile && <p>此代理尚未提供对话文件，等待原生进度更新。</p>}
      {!state.loading && agent.sessionFile && !state.messages.length && (
        <p>尚无已保存消息。</p>
      )}
      <Transcript messages={state.messages} tools={[]} sessionId={agent.id} />
    </section>
  );
}

function observeTranscript(options: {
  readonly sessionId?: string;
  readonly transport: SubagentTransport;
  readonly agent: SubagentSnapshot;
  readonly setMessages: Dispatch<SetStateAction<TimelineMessage[]>>;
  readonly setError: (value: string) => void;
  readonly setLoading: (value: boolean) => void;
}) {
  const { transport, agent, setMessages, setError, setLoading } = options;
  let disposed = false;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout>;
  setMessages([]);
  setError("");
  setLoading(true);
  async function read() {
    try {
      const result = await readTranscript({
        transport,
        agent,
        sessionId: options.sessionId,
        fromByte: cursor,
      });
      if (disposed) return;
      setMessages((previous) => {
        const retained = result.reset ? [] : previous;
        return [
          ...retained,
          ...result.messages.map((message, index) => ({
            key: `${agent.id}:${retained.length + index}`,
            message,
            streaming: false,
          })),
        ];
      });
      cursor = result.nextByte;
      if (agent.status === "running" || agent.status === "pending")
        timer = setTimeout(read, TRANSCRIPT_REFRESH_MS);
    } catch (failure) {
      if (!disposed) setError(String(failure));
    } finally {
      if (!disposed) setLoading(false);
    }
  }
  void read();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}

async function readTranscript(options: {
  readonly transport: SubagentTransport;
  readonly agent: SubagentSnapshot;
  readonly sessionId?: string;
  readonly fromByte: number;
}) {
  const { transport, agent, sessionId, fromByte } = options;
  if (!agent.historical)
    return transport.request<SubagentTranscriptResult>({
      type: "get_subagent_messages",
      subagentId: agent.id,
      fromByte,
    });
  if (!sessionId) throw new Error("缺少历史子代理所属会话标识");
  return transport.subagentHistory<SubagentTranscriptResult>({
    op: "messages",
    sessionId,
    subagentId: agent.id,
    fromByte,
  });
}
