import { RewindToolbar } from "./RewindToolbar";
import { RewindTranscript } from "./RewindTranscript";
import { useRewind, type RewindOptions } from "./useRewind";

/** 将高频选择状态限制在回退界面，避免每次按键重绘整个工作台。 */
export function RewindMode({
  sessionId,
  ...options
}: Omit<RewindOptions, "enabled"> & { readonly sessionId: string }) {
  const rewind = useRewind({ ...options, enabled: true });
  return (
    <>
      <div className="transcript rewind-active">
        <RewindTranscript rewind={rewind} sessionId={sessionId} />
      </div>
      <RewindToolbar rewind={rewind} />
    </>
  );
}
