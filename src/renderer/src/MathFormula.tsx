import { useState } from "react";
import type { ReactNode } from "react";
import { ReviewIconButton } from "./ReviewIconButton";

/** 行间公式提供图标化源码切换；渲染内容继续来自安全管线，流式更新保留显示模式。 */
export function MathFormula({
  source,
  children,
}: {
  readonly source: string;
  readonly children?: ReactNode;
}) {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState<{ source: string; label: string }>();
  // 流式输出会改变 source；旧结果只对当时复制的内容有效，内容变化后回到初始文案。
  const copyLabel = copied?.source === source ? copied.label : "复制公式源码";
  /** 通过主进程系统剪贴板复制公式源码，无需 Web Clipboard 权限。 参数：无。 @returns 复制操作完成。 */
  async function copySource() {
    const copiedSource = source;
    try {
      await window.desktop.copyText(copiedSource);
      setCopied({ source: copiedSource, label: "已复制" });
    } catch (error) {
      setCopied({
        source: copiedSource,
        label: `复制失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return (
    <span className="rich-math rich-math-display">
      <span className="rich-math-controls">
        <ReviewIconButton
          icon={<path d="M9 9h11v11H9ZM5 15V5h10" />}
          tooltip={copyLabel}
          aria-label={copyLabel}
          onClick={copySource}
        />
        <ReviewIconButton
          icon={showSource ? "preview" : <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />}
          tooltip={showSource ? "渲染公式" : "查看公式源码"}
          aria-label={showSource ? "渲染公式" : "查看公式源码"}
          onClick={() => setShowSource((value) => !value)}
        />
      </span>
      {showSource ? (
        <span className="rich-math-source">{source}</span>
      ) : (
        <span className="rich-math-rendered">{children}</span>
      )}
    </span>
  );
}
