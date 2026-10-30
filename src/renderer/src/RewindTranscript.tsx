import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { SessionEntry } from "../../shared/protocol";
import { Transcript } from "./Transcript";
import { rewindEntryMessage, type RewindTarget } from "./rewind-targets";
import type { RewindController } from "./useRewind";
import "./rewind.css";

interface RunProps {
  readonly targets: readonly RewindTarget[];
  readonly entries: ReadonlyMap<string, SessionEntry>;
  readonly sessionId: string;
  readonly rewind: RewindController;
  readonly variantIndex: number;
  readonly startIndex?: number;
  readonly visibleIds?: ReadonlySet<string>;
}

/** 选择只改变外框；消息及工具详情在历史未变化时复用已渲染内容。 */
const RewindBody = memo(
  function RewindBody({
    target,
    entries,
    sessionId,
  }: {
    target: RewindTarget;
    entries: RunProps["entries"];
    sessionId: string;
  }) {
    return (
      <Transcript
        messages={targetMessages(target, entries)}
        tools={[]}
        sessionId={sessionId}
        inlineProcess
      />
    );
  },
  (previous, next) =>
    previous.entries === next.entries &&
    previous.sessionId === next.sessionId &&
    previous.target.entryIds.length === next.target.entryIds.length &&
    previous.target.entryIds.every(
      (id, index) => id === next.target.entryIds[index],
    ),
);

/** 保留真实 entry 标识，使一个虚线框涵盖调用及其所有结果。 */
function targetMessages(
  target: RewindTarget,
  entries: ReadonlyMap<string, SessionEntry>,
) {
  return target.entryIds.flatMap((id) => {
    const entry = entries.get(id);
    if (!entry) throw new Error(`原生会话历史缺少回退消息：${id}`);
    const message = rewindEntryMessage(entry);
    return message ? [{ key: id, message, streaming: false }] : [];
  });
}

/** 每个可见原生目标单独成组，不让执行过程跨过虚线选择边界。 */
function RewindRun({
  targets,
  entries,
  sessionId,
  rewind,
  variantIndex,
  startIndex = 0,
  visibleIds,
}: RunProps) {
  const selectedIndex =
    variantIndex === rewind.variantIndex
      ? variantIndex === 0
        ? rewind.mainSelected
        : targets.findIndex(
            (target) => target.turnId === rewind.selectedTarget?.turnId,
          )
      : -1;
  return (
    <>
      {targets.map(
        (target, index) =>
          (!visibleIds || visibleIds.has(target.turnId)) && (
            <section
              key={target.turnId}
              data-rewind-id={target.turnId}
              className={`rewind-message ${index + startIndex === selectedIndex ? "rewind-target" : ""} ${selectedIndex >= 0 && index + startIndex > selectedIndex && !rewind.filterMode ? "rewind-dropped" : ""}`}
              aria-current={
                index + startIndex === selectedIndex ? "true" : undefined
              }
              aria-label={`回退消息 ${target.turnId}`}
              onClick={() => {
                if (!rewind.disabled)
                  rewind.select(target.turnId, variantIndex);
              }}
            >
              {index + startIndex === selectedIndex && (
                <div className="rewind-target-caption">Continue from here</div>
              )}
              <RewindBody
                target={target}
                entries={entries}
                sessionId={sessionId}
              />
            </section>
          ),
      )}
    </>
  );
}

interface MainSegment {
  readonly startIndex: number;
  readonly forkId?: string;
  readonly targets: readonly RewindTarget[];
}

/** 按历史中固定的分岔位置分段，选择变化不会移动主路径消息的 React 父节点。 */
function mainSegments(
  targets: readonly RewindTarget[],
  entries: RunProps["entries"],
): MainSegment[] {
  const childCounts = new Map<string | null, number>();
  for (const entry of entries.values())
    childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
  const segments: MainSegment[] = [];
  let start = 0;
  let forkId: string | undefined;
  targets.forEach((target, index) => {
    if ((childCounts.get(entries.get(target.turnId)!.parentId) ?? 0) < 2)
      return;
    if (index > start)
      segments.push({
        startIndex: start,
        forkId,
        targets: targets.slice(start, index),
      });
    start = index;
    forkId = target.turnId;
  });
  segments.push({ startIndex: start, forkId, targets: targets.slice(start) });
  return segments;
}

/** 非选中分岔的容器仅参与组件复用；选中后将同一主路径尾部与兄弟列并排。 */
function RewindPath({
  segments,
  segmentIndex = 0,
  ...props
}: Omit<RunProps, "targets" | "variantIndex"> & {
  segments: readonly MainSegment[];
  segmentIndex?: number;
}) {
  const segment = segments[segmentIndex];
  const { rewind } = props;
  const active = Boolean(
    segment.forkId && segment.forkId === rewind.columns[0]?.rootId,
  );
  return (
    <div className={active ? "rewind-branch-strip" : "rewind-path-fragment"}>
      <div className={active ? "rewind-branch-column" : "rewind-path-fragment"}>
        <p className="rewind-branch-heading" hidden={!active}>
          1/{rewind.columns.length} · current
        </p>
        <RewindRun
          {...props}
          targets={segment.targets}
          startIndex={segment.startIndex}
          variantIndex={0}
        />
        {segmentIndex + 1 < segments.length && (
          <RewindPath
            {...props}
            segments={segments}
            segmentIndex={segmentIndex + 1}
          />
        )}
      </div>
      {active &&
        rewind.columns.slice(1).map((column, index) => (
          <div className="rewind-branch-column" key={column.rootId}>
            <p className="rewind-branch-heading">
              {index + 2}/{rewind.columns.length} · {column.label}
            </p>
            <RewindRun
              targets={column.targets}
              {...props}
              variantIndex={index + 1}
            />
          </div>
        ))}
    </div>
  );
}

/** 将虚线目标滚入所在列和聊天滚动区域；进入时接管正文键盘焦点。 */
function useRewindScroll(rewind: RewindController) {
  const container = useRef<HTMLDivElement>(null);
  const lastWheel = useRef(-Infinity);
  const { disabled, move } = rewind;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (
        disabled ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      // 工具详情仍可独立滚动；正文滚轮只移动目标，不同时滚动整页。
      let target = event.target instanceof Element ? event.target : null;
      while (target && target !== element) {
        if (
          target.scrollHeight > target.clientHeight &&
          /auto|scroll/.test(getComputedStyle(target).overflowY)
        )
          return;
        target = target.parentElement;
      }
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheel.current < 120) return;
      lastWheel.current = now;
      move(event.deltaY < 0 ? "ArrowUp" : "ArrowDown");
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [disabled, move]);
  useLayoutEffect(() => {
    container.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    container.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
  }, [rewind.selectedTarget?.turnId, rewind.variantIndex, rewind.filterMode]);
  return container;
}

/** 在聊天正文中预览并选择回退点；仅 Enter 或继续按钮会改变原生上下文。 */
export function RewindTranscript({
  rewind,
  sessionId,
}: {
  readonly rewind: RewindController;
  readonly sessionId: string;
}) {
  const container = useRewindScroll(rewind);
  const entries = useMemo(
    () => new Map(rewind.historyEntries.map((entry) => [entry.id, entry])),
    [rewind.historyEntries],
  );
  const segments = useMemo(
    () => mainSegments(rewind.mainTargets, entries),
    [rewind.mainTargets, entries],
  );
  const visibleIds = useMemo(
    () =>
      rewind.filterMode
        ? new Set(rewind.matchingTargets.map((target) => target.turnId))
        : undefined,
    [rewind.filterMode, rewind.matchingTargets],
  );
  const targets = rewind.filterMode ? rewind.matchingTargets : rewind.targets;
  return (
    <div className="rewind-transcript" ref={container} tabIndex={-1}>
      <RewindPath
        segments={segments}
        visibleIds={visibleIds}
        rewind={rewind}
        entries={entries}
        sessionId={sessionId}
      />
      {!targets.length && (
        <p className="rewind-empty">
          {rewind.filterMode
            ? `No turns match "${rewind.query}"`
            : "No messages to rewind"}
        </p>
      )}
    </div>
  );
}
