import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  TREE_FILTERS,
  TREE_FILTER_LABELS,
  type NativeTreeRow,
} from "./native-tree-data";
import { useNativeTree } from "./useNativeTree";
import type { NativeTreeScreenProps } from "./native-tree-types";
import "./native-tree.css";

export type {
  NativeTreeScreenProps,
  TreeNavigation,
  TreeLabelChange,
} from "./native-tree-types";
type TreeView = ReturnType<typeof useNativeTree>;

/** 全屏复刻原生 /tree 的树行、搜索和键盘导航。[in] props：注入会话及操作。返回值：页面。 */
export function NativeTreeScreen(props: NativeTreeScreenProps) {
  const view = useNativeTree(props);
  return (
    <div
      className="native-tree-screen"
      inert={props.suspended}
      role="dialog"
      aria-modal="true"
      aria-label="会话树"
      ref={view.screen}
    >
      <TreeHeader view={view} props={props} />
      <TreeFilters view={view} />
      {view.error && (
        <p className="native-tree-error" role="alert">
          {view.error}
        </p>
      )}
      <TreeContent view={view} renderContent={props.renderContent} />
      <TreeFooter view={view} />
      {view.deleteTarget && <TreeDeleteDialog view={view} />}
    </div>
  );
}

/** 标签编辑优先，否则显示树行或注入可视化。[in] options：视图及内容插槽。返回值：内容。 */
function TreeContent({
  view,
  renderContent,
}: {
  view: TreeView;
  renderContent: NativeTreeScreenProps["renderContent"];
}) {
  if (view.labelTarget) return <TreeLabelEditor view={view} />;
  if (!renderContent) return <TreeRows view={view} />;
  return (
    <div className="native-tree-custom" ref={view.list}>
      {renderContent({
        rows: view.rows,
        selectedId: view.selectedId,
        pending: view.pending || Boolean(view.deleteTarget),
        onSelect: view.setSelected,
        onActivate: (id, summarize = false) =>
          void view.navigate(summarize, id),
        onLabel: view.editLabel,
        onDelete: view.canDelete ? view.requestDelete : undefined,
      })}
    </div>
  );
}

/** 标题及原生快捷键提示。[in] options：视图和页面属性。返回值：标题区。 */
function TreeHeader({
  view,
  props,
}: {
  view: TreeView;
  props: NativeTreeScreenProps;
}) {
  return (
    <header className="native-tree-header">
      <div className="native-tree-title">
        <h2>Session Tree</h2>
        <span>{props.sessionName}</span>
        <div className="native-tree-toolbar">
          {props.toolbar}
          <button
            onClick={view.close}
            disabled={view.closeDisabled}
            aria-label={view.pending ? "取消导航" : "关闭会话树"}
          >
            {view.pending
              ? view.cancelling
                ? "正在取消…"
                : view.closeDisabled
                  ? "处理中…"
                  : "取消导航"
              : "Esc ×"}
          </button>
        </div>
      </div>
      <p>
        <kbd>Enter</kbd> 切换 · <kbd>Alt ↑/↓</kbd> 上一/下一轮 ·{" "}
        <kbd>←/→ PgUp/PgDn</kbd> 翻页 · <kbd>Home/End</kbd> 首尾 ·{" "}
        <kbd>Shift Enter</kbd> 总结并切换 · <kbd>Shift L</kbd> 标签 ·{" "}
        <kbd>Ctrl O</kbd> 筛选
      </p>
    </header>
  );
}

/** 五种原生筛选及模糊搜索。[in] view：视图。返回值：查询区。 */
function TreeFilters({ view }: { view: TreeView }) {
  const shortcuts = ["D", "T", "U", "L", "A"];
  return (
    <div className="native-tree-controls">
      <div role="tablist" aria-label="条目筛选" className="native-tree-filters">
        {TREE_FILTERS.map((filter, index) => (
          <button
            key={filter}
            role="tab"
            aria-selected={view.filter === filter}
            onClick={() => view.setFilter(filter)}
            disabled={view.pending}
          >
            {TREE_FILTER_LABELS[filter]} <kbd>Alt {shortcuts[index]}</kbd>
          </button>
        ))}
      </div>
      <label className="native-tree-search">
        <span>Search:</span>
        <input
          ref={view.search}
          aria-label="搜索会话树"
          placeholder="输入以搜索"
          value={view.query}
          onChange={(event) => view.setQuery(event.target.value)}
          disabled={view.pending || Boolean(view.labelTarget)}
        />
      </label>
    </div>
  );
}

/** 呈现当前路径标记、连接线、标签及光标。[in] options：行与视图。返回值：树行。 */
function TreeRow({ row, view }: { row: NativeTreeRow; view: TreeView }) {
  const id = row.node.entry.id;
  const selected = id === view.selectedId;
  return (
    <button
      type="button"
      className="native-tree-row"
      role="option"
      aria-selected={selected}
      id={`native-tree-${id}`}
      disabled={view.pending}
      onKeyDown={(event) => treeRowKey(event, view, id)}
      onClick={() => {
        view.setSelected(id);
        void view.navigate(false, id);
      }}
      title={`${row.text} · ${id}`}
    >
      <span className="native-tree-cursor">{selected ? "›" : " "}</span>
      <span className="native-tree-gutter" aria-hidden="true">
        {row.prefix}
      </span>
      <span
        className="native-tree-active"
        aria-label={row.active ? "当前路径" : undefined}
      >
        {row.active ? "• " : ""}
      </span>
      {row.node.label && (
        <span className="native-tree-label">[{row.node.label}] </span>
      )}
      <span
        className={`native-tree-copy native-tree-${row.node.entry.message?.role ?? "metadata"}`}
      >
        {row.text}
      </span>
    </button>
  );
}

/** 焦点位于行按钮时保留原生总结快捷键。[in] event：按键；[in] view：状态；[in] id：目标。返回值：无。 */
function treeRowKey(
  event: KeyboardEvent<HTMLButtonElement>,
  view: TreeView,
  id: string,
) {
  if (event.key !== "Enter" || !event.shiftKey || event.nativeEvent.isComposing)
    return;
  event.preventDefault();
  view.setSelected(id);
  void view.navigate(true, id);
}

/** 可滚动的原生行列表。[in] view：视图。返回值：列表。 */
function TreeRows({ view }: { view: TreeView }) {
  const empty = view.query
    ? `没有条目匹配“${view.query}”。按 Esc 清除搜索。`
    : `${view.total} 个条目被当前筛选隐藏。按 Alt A 显示全部。`;
  return (
    <div
      className="native-tree-list"
      ref={view.list}
      role="listbox"
      aria-label="会话条目"
      aria-activedescendant={
        view.selectedId ? `native-tree-${view.selectedId}` : undefined
      }
    >
      {view.rows.map((row) => (
        <TreeRow key={row.node.entry.id} row={row} view={view} />
      ))}
      {!view.rows.length && (
        <p className="native-tree-empty">
          {view.total ? empty : "当前会话没有条目。"}
        </p>
      )}
    </div>
  );
}

/** 标签编辑替换树列表，清空即删除标签。[in] view：视图。返回值：表单。 */
function TreeLabelEditor({ view }: { view: TreeView }) {
  const [value, setValue] = useState(view.labelTarget?.label ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className="native-tree-label-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void view.saveLabel(value);
      }}
    >
      <h3>编辑标签</h3>
      <p>留空以移除标签</p>
      <input
        ref={input}
        aria-label="条目标签"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={view.pending}
      />
      <div>
        <button type="submit" disabled={view.pending}>
          Enter 保存
        </button>
        <button
          type="button"
          disabled={view.pending}
          onClick={() => {
            view.setLabelTarget(null);
            view.search.current?.focus();
          }}
        >
          Esc 取消
        </button>
      </div>
    </form>
  );
}

/** 删除确认独占焦点；只有明确确认才提交当前完整子树标识。 */
function TreeDeleteDialog({ view }: { view: TreeView }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  return (
    <div className="confirm-backdrop">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="确认删除会话节点"
        ref={dialog}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            view.cancelDelete();
          }
          if (event.key === "Tab") {
            event.preventDefault();
            const buttons = [
              ...dialog.current!.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              (index + (event.shiftKey ? -1 : 1) + buttons.length) %
                buttons.length
            ]?.focus();
          }
        }}
      >
        <h3>删除节点及子节点？</h3>
        <p>
          将永久删除当前节点及其所有子节点，共{" "}
          {view.deleteTarget!.entryIds.length} 个节点。此操作无法撤销。
        </p>
        <p>若包含当前会话路径，将回退到保留的父节点。项目文件不会被删除。</p>
        {view.error && <p role="alert">{view.error}</p>}
        <div className="action-row">
          <button disabled={view.pending} onClick={view.cancelDelete}>
            取消
          </button>
          <button
            disabled={view.pending}
            onClick={() => void view.confirmDelete()}
          >
            {view.pending ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 显示位置和可点击原生操作。[in] view：视图。返回值：页脚。 */
function TreeFooter({ view }: { view: TreeView }) {
  const position =
    view.rows.findIndex((row) => row.node.entry.id === view.selectedId) + 1;
  return (
    <footer className="native-tree-footer">
      <span>
        ({position}/{view.rows.length}) [{TREE_FILTER_LABELS[view.filter]}]
      </span>
      <span className="native-tree-footer-hint">
        ↑/↓ 选择 · 直接输入搜索 · Esc 清除搜索/返回
      </span>
      <button
        onClick={() => view.editLabel()}
        disabled={!view.selectedId || view.pending || Boolean(view.labelTarget)}
      >
        Shift L 标签
      </button>
      {view.canDelete && (
        <button
          onClick={() => view.requestDelete()}
          disabled={
            !view.selectedId || view.pending || Boolean(view.labelTarget)
          }
        >
          删除节点及子节点
        </button>
      )}
      <button
        onClick={() => void view.navigate(true)}
        disabled={!view.selectedId || view.pending || Boolean(view.labelTarget)}
      >
        Shift Enter 总结并切换
      </button>
      <button
        className="native-tree-confirm"
        onClick={() => void view.navigate(false)}
        disabled={!view.selectedId || view.pending || Boolean(view.labelTarget)}
      >
        {view.pending ? "处理中…" : "Enter 切换"}
      </button>
    </footer>
  );
}
