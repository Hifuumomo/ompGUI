import { useContext, type MouseEvent } from "react";
import { messageFileHref } from "../../shared/message-file-link";
import { MessageFileLinks } from "./MessageFileLinks";
import type {
  ToolDescription,
  ToolTarget,
} from "../../shared/tool-presentation";
import type { ToolEvidence } from "./transcript-types";
import type { ProcessContext } from "./TranscriptToolRow";

/** 分开目录与末级名称，让窄布局优先省略目录，原始路径仍用于标题与点击。 */
function ToolTargetLabel({ target }: { target: ToolTarget }) {
  if (target.kind !== "file") return target.label;
  const parts = /^(.*[\\/])([^\\/]+[\\/]*)$/.exec(target.path);
  return (
    <>
      {parts && <span className="tool-target-directory">{parts[1]}</span>}
      <span className="tool-target-filename">{parts?.[2] ?? target.path}</span>
    </>
  );
}

/** 文件目标行尾的「↗」：在侧栏打开文件，不触发展开；没有打开入口时不渲染。 */
function OpenTargetButton({ path }: { path: string }) {
  const openFile = useContext(MessageFileLinks);
  if (!openFile) return null;
  function open(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void openFile!(messageFileHref(path)).catch(() => {
      /* 打开失败由文件侧栏自身提示。 */
    });
  }
  return (
    <button
      type="button"
      className="tool-target-open"
      aria-label={`在侧栏打开 ${path}`}
      title="在侧栏打开"
      onClick={open}
    >
      ↗
    </button>
  );
}

export function ToolTargetButton({
  target,
  tool,
  index,
  context,
  panelId,
}: {
  target: ToolTarget;
  tool: ToolEvidence;
  index: number;
  context: ProcessContext;
  panelId: string;
}) {
  function inspect(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    context.toggle(tool.id, index);
  }
  return (
    <>
      <button
        type="button"
        className="tool-target"
        data-tool-id={tool.id}
        data-target-kind={target.kind}
        data-target-path={target.kind === "file" ? target.path : undefined}
        title={target.kind === "file" ? target.path : target.label}
        aria-expanded={context.expanded[tool.id] === index}
        aria-controls={panelId}
        onClick={inspect}
      >
        <ToolTargetLabel target={target} />
      </button>
      {target.kind === "file" && <OpenTargetButton path={target.path} />}
    </>
  );
}

/** 多对象摘要只预览第一个对象，展开后对象由独立列表呈现。 */
export function ToolTargets({
  tool,
  description,
  context,
  open,
  hideVerb = false,
}: {
  tool: ToolEvidence;
  description: ToolDescription;
  context: ProcessContext;
  open: boolean;
  hideVerb?: boolean;
}) {
  const target = description.targets[0];
  const multiple = description.targets.length > 1;
  return (
    <>
      {!hideVerb && <span>{description.verb}</span>}
      {multiple ? (
        (!open || hideVerb) && (
          <>
            <span
              className="tool-target tool-target-preview"
              data-target-kind={target.kind}
              title={target.kind === "file" ? target.path : target.label}
            >
              <ToolTargetLabel target={target} />
            </span>
            <span aria-hidden="true">…</span>
          </>
        )
      ) : target ? (
        <ToolTargetButton
          target={target}
          index={0}
          tool={tool}
          context={context}
          panelId={context.panelId(tool.id)}
        />
      ) : (
        <span>{description.summary ?? tool.name}</span>
      )}
    </>
  );
}
