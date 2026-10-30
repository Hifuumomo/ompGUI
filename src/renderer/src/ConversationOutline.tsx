import { useEffect, useRef, useState, type RefObject } from "react";
import { displayMessageText } from "./session";
import type { TranscriptUnit } from "./transcript-types";
import "./conversation-outline.css";

export interface OutlineEntry {
  key: string;
  title: string;
  preview: string;
}

/** 每条有正文的用户提示生成一项，摘要取同轮首条助手正文。 */
export function outlineEntries(units: TranscriptUnit[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const unit of units) {
    if (unit.kind !== "message") continue;
    const text = displayMessageText(unit.message).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (unit.message.role === "user") {
      entries.push({ key: unit.key, title: text, preview: "" });
    } else if (unit.message.role === "assistant") {
      const last = entries.at(-1);
      if (last && !last.preview) last.preview = text;
    }
  }
  return entries;
}

interface ConversationOutlineProps {
  entries: OutlineEntry[];
  /** 用户消息键到正文节点的映射，由 Transcript 维护。 */
  targets: RefObject<Map<string, HTMLElement>>;
}

/** 仿 ChatGPT 的提示词目录：左缘短线，悬停伸长并显示摘要，点击跳转。 */
export function ConversationOutline({
  entries,
  targets,
}: ConversationOutlineProps) {
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<{ index: number; top: number }>();

  // 视口上三分之一处所在的提示词为当前条目。
  useEffect(() => {
    const container = rail.current?.closest<HTMLElement>(".transcript");
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line =
        container.getBoundingClientRect().top + container.clientHeight / 3;
      let current = 0;
      entries.forEach((entry, index) => {
        const target = targets.current?.get(entry.key);
        if (target && target.getBoundingClientRect().top <= line)
          current = index;
      });
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [entries, targets]);

  // 条目过多时轨道可滚动，保持当前条目可见。
  useEffect(() => {
    const element = rail.current;
    const item = element?.children[active] as HTMLElement | undefined;
    if (!element || !item) return;
    if (item.offsetTop < element.scrollTop) element.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      element.scrollTop + element.clientHeight
    )
      element.scrollTop =
        item.offsetTop + item.offsetHeight - element.clientHeight;
  }, [active]);

  if (entries.length < 2) return null;
  const show = (index: number, item: HTMLElement) => {
    const element = rail.current;
    if (!element) return;
    setHover({
      index,
      top:
        element.offsetTop +
        item.offsetTop -
        element.scrollTop +
        item.offsetHeight / 2,
    });
  };
  const card = hover && entries[hover.index];
  return (
    <nav
      className="conversation-outline"
      aria-label="提示词目录"
      onMouseLeave={() => setHover(undefined)}
    >
      <div
        className="outline-rail"
        ref={rail}
        onScroll={() => setHover(undefined)}
      >
        {entries.map((entry, index) => (
          <button
            key={entry.key}
            type="button"
            className="outline-item"
            aria-label={entry.title}
            aria-current={index === active ? "location" : undefined}
            onMouseEnter={(event) => show(index, event.currentTarget)}
            onFocus={(event) => show(index, event.currentTarget)}
            onBlur={() => setHover(undefined)}
            onClick={() =>
              targets.current
                ?.get(entry.key)
                ?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
          >
            <span />
          </button>
        ))}
      </div>
      {card && (
        <div
          className="outline-card"
          role="tooltip"
          style={{ top: hover.top }}
        >
          <strong>{card.title}</strong>
          {card.preview && <p>{card.preview}</p>}
        </div>
      )}
    </nav>
  );
}
