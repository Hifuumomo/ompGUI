import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";
import { projectImageType } from "../../shared/project-browser";
import { sameProjectPath } from "../../shared/message-file-link";
import {
  changesTree,
  flattenTreeFiles,
  treeAncestors,
  treePath,
} from "./project-tree-model";
import { TreeNodes, type ProjectTreeContext } from "./ProjectFileTree";
import { TreeChevron } from "./TreeChevron";
import { ReviewIconButton } from "./ReviewIconButton";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { LocalSourceMarkers } from "./LocalCommentMarkers";
import type { LocalCommentRevealRequest } from "./local-comment-reveal";
import { useProjectFileMenu } from "./useProjectFileMenu";
import {
  ChangeFileSection,
  type DiffLayout,
  type DiffResource,
} from "./ChangeFileSection";
import type { useProjectChanges } from "./useProjectChanges";
import "./project-file-tree.css";

/** 主进程只有一个线程逐个处理差异任务，同时发出的读取请求必须有上限。 */
const MAX_DIFF_READS = 3;
const EMPTY_FILES: readonly ProjectEntry[] = [];
const NO_EXPANDED: ReadonlySet<string> = new Set();
const NO_RESOURCES: ReadonlyMap<string, DiffResource> = new Map();

interface Props {
  readonly cwd: string;
  readonly browser: ProjectBrowser & ProjectReview;
  readonly state: ReturnType<typeof useProjectChanges>;
  readonly revision: number;
  /** 页面隐藏时不渲染路径标记，也不响应评论定位的目录展开。 */
  readonly active: boolean;
  readonly filesVisible: boolean;
  readonly wrap: boolean;
  readonly layout: DiffLayout;
  readonly collapsed: ReadonlySet<string>;
  readonly commentReveal?: LocalCommentRevealRequest;
  /** 评论定位到变更页某个文件的 Diff 时的目标路径：强制展开并读取该区块。 */
  readonly revealPath?: string;
  readonly onToggleFiles: () => void;
  readonly onToggleWrap: () => void;
  readonly onToggleLayout: () => void;
  readonly onRefresh: () => void;
  readonly onToggleSection: (path: string) => void;
  readonly onExpandSection: (path: string) => void;
  /** collapse 为 true 时折叠 paths 中的全部区块，否则全部展开。 */
  readonly onToggleAll: (paths: readonly string[], collapse: boolean) => void;
  readonly onOpenInFiles: (entry: ProjectEntry) => void;
  readonly onShowFiles: () => void;
}

function LayoutIcon({ layout }: { readonly layout: DiffLayout }) {
  return (
    <>
      <rect x="2.5" y="3" width="19" height="18" rx="3" stroke="#858993" />
      {layout === "split" ? (
        <>
          <rect x="5.5" y="6" width="5.5" height="12" rx="1" fill="#efa0ab" stroke="none" />
          <rect x="13" y="6" width="5.5" height="12" rx="1" fill="#8cddb0" stroke="none" />
        </>
      ) : (
        <>
          <rect x="5.5" y="6" width="13" height="5" rx="1" fill="#efa0ab" stroke="none" />
          <rect x="5.5" y="13" width="13" height="5" rx="1" fill="#8cddb0" stroke="none" />
        </>
      )}
    </>
  );
}

/**
 * 变更页：左侧目录栏 + 右侧所有变更文件的连续 Diff。
 * 离屏区块只渲染标题行，进入视口附近才读取差异，读取并发有上限。
 * @param props [in] 变更读取状态、折叠状态、布局及各类回调。
 * @returns 变更页的工具行与内容区。
 */
export function ProjectChangesPage(props: Props) {
  const { state, active } = props;
  const info = state.status === "ready" ? state.value : undefined;
  const files = info?.kind === "git" ? info.files : EMPTY_FILES;
  const [query, setQuery] = useState("");
  const [rootOpen, setRootOpen] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set());
  const [current, setCurrent] = useState<string>();
  const [near, setNear] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const navRoot = useRef<HTMLElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const intersecting = useRef(new Set<string>());
  const lock = useRef<number | undefined>(undefined);
  const nearObserver = useRef<IntersectionObserver | undefined>(undefined);
  const currentObserver = useRef<IntersectionObserver | undefined>(undefined);

  const visibleFiles = useMemo(() => {
    const keyword = query.toLowerCase();
    return keyword
      ? files.filter((file) => file.path.toLowerCase().includes(keyword))
      : files;
  }, [files, query]);
  const nodes = useMemo(
    () => changesTree(props.cwd, visibleFiles),
    [props.cwd, visibleFiles],
  );
  // 区块顺序与目录栏从上到下的顺序一致。
  const ordered = useMemo(() => flattenTreeFiles(nodes), [nodes]);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const allCollapsed =
    files.length > 0 && files.every((file) => props.collapsed.has(file.path));

  const menuChanges: ProjectChanges = useMemo(
    () => info ?? { kind: "plain", root: props.cwd, base: null, files: EMPTY_FILES },
    [info, props.cwd],
  );
  const menu = useProjectFileMenu({
    root: props.cwd,
    browser: props.browser,
    changes: menuChanges,
    revision: props.revision,
    resetOn: [active, query, rootOpen],
  });

  // 评论定位到变更页（Diff 或已删除文件的路径）时清除筛选并展开祖先目录。
  useLayoutEffect(() => {
    const request = props.commentReveal;
    if (!active || !request) return;
    setQuery("");
    setRootOpen(true);
    const ancestors = treeAncestors(request.file.path);
    setCollapsedDirs(
      (old) => new Set([...old].filter((path) => !ancestors.includes(path))),
    );
  }, [props.commentReveal, active]);

  // ---- 滚动联动 ----
  /** 取右侧顶部可见的第一个文件作为目录栏高亮；程序化滚动期间不更新。 */
  const applyCurrent = useCallback(() => {
    const first = orderedRef.current.find((entry) =>
      intersecting.current.has(entry.path),
    );
    if (first) setCurrent(first.path);
  }, []);
  /** 暂停高亮更新直到滚动停止，避免点击目录后高亮在途经的文件上跳动。 */
  const hold = useCallback(() => {
    window.clearTimeout(lock.current);
    lock.current = window.setTimeout(() => {
      lock.current = undefined;
      applyCurrent();
    }, 200);
  }, [applyCurrent]);
  const register = useCallback((path: string, element: HTMLElement | null) => {
    const old = elements.current.get(path);
    if (old && old !== element) {
      nearObserver.current?.unobserve(old);
      currentObserver.current?.unobserve(old);
      intersecting.current.delete(path);
    }
    if (!element) {
      elements.current.delete(path);
      return;
    }
    elements.current.set(path, element);
    nearObserver.current?.observe(element);
    currentObserver.current?.observe(element);
  }, []);

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const pathOf = (entry: IntersectionObserverEntry) =>
      (entry.target as HTMLElement).dataset.changePath ?? "";
    // 上下各预读约一屏。
    const nearObs = new IntersectionObserver(
      (entries) =>
        setNear((old) => {
          const next = new Set(old);
          for (const entry of entries) {
            if (entry.isIntersecting) next.add(pathOf(entry));
            else next.delete(pathOf(entry));
          }
          return next;
        }),
      { root, rootMargin: "100% 0px" },
    );
    // 只统计滚动容器顶部 20% 区域内的区块，对应“当前文件”。
    const currentObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) intersecting.current.add(pathOf(entry));
          else intersecting.current.delete(pathOf(entry));
        }
        if (lock.current === undefined) applyCurrent();
      },
      { root, rootMargin: "0px 0px -80% 0px" },
    );
    nearObserver.current = nearObs;
    currentObserver.current = currentObs;
    for (const element of elements.current.values()) {
      nearObs.observe(element);
      currentObs.observe(element);
    }
    return () => {
      nearObs.disconnect();
      currentObs.disconnect();
      nearObserver.current = undefined;
      currentObserver.current = undefined;
    };
  }, [applyCurrent]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onScroll = () => {
      if (lock.current !== undefined) hold();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      window.clearTimeout(lock.current);
    };
  }, [hold]);

  /** 点击目录栏文件：展开并滚动到对应区块。 */
  function showFile(entry: ProjectEntry) {
    props.onExpandSection(entry.path);
    setCurrent(entry.path);
    hold();
    elements.current
      .get(entry.path)
      ?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }

  // ---- 差异读取调度 ----
  const supportsObserver = typeof IntersectionObserver !== "undefined";
  const isForced = (path: string) =>
    !!props.revealPath && sameProjectPath(props.revealPath, path);
  const wanted = useMemo(() => {
    const currentIndex = Math.max(
      0,
      ordered.findIndex((entry) => entry.path === current),
    );
    const forced = (path: string) =>
      !!props.revealPath && sameProjectPath(props.revealPath, path);
    return ordered
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          !projectImageType(entry.path) &&
          (forced(entry.path) ||
            (!props.collapsed.has(entry.path) &&
              (!supportsObserver || near.has(entry.path)))),
      )
      // 优先读取被强制定位的区块，其余按离当前文件的远近排序。
      .sort(
        (a, b) =>
          (forced(a.entry.path) ? -1 : Math.abs(a.index - currentIndex)) -
          (forced(b.entry.path) ? -1 : Math.abs(b.index - currentIndex)),
      )
      .map(({ entry }) => entry);
  }, [ordered, near, props.collapsed, props.revealPath, current, supportsObserver]);

  // 刷新、切换来源或变更列表更新后，整批结果作废。
  const token = useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.browser, info?.files, info?.root, info?.base, props.revision],
  );
  const [cache, setCache] = useState<{
    readonly token: object;
    readonly map: ReadonlyMap<string, DiffResource>;
  }>({ token, map: NO_RESOURCES });
  const resources = cache.token === token ? cache.map : NO_RESOURCES;
  const running = useRef<{ token: object; inflight: Set<string> }>({
    token,
    inflight: new Set(),
  });

  useEffect(() => {
    // 页面隐藏时不发起新的读取（例如其它标签页触发的刷新），切回后再按视口补读。
    if (!active || !info || info.kind !== "git") return;
    if (running.current.token !== token)
      running.current = { token, inflight: new Set() };
    const run = running.current;
    const starts: ProjectEntry[] = [];
    for (const entry of wanted) {
      if (run.inflight.size >= MAX_DIFF_READS) break;
      if (run.inflight.has(entry.path) || resources.has(entry.path)) continue;
      run.inflight.add(entry.path);
      starts.push(entry);
    }
    if (!starts.length) return;
    setCache((old) => {
      const map = new Map(old.token === token ? old.map : NO_RESOURCES);
      for (const entry of starts) map.set(entry.path, { status: "loading" });
      return { token, map };
    });
    for (const entry of starts) {
      const settle = (resource: DiffResource) => {
        run.inflight.delete(entry.path);
        // 过期批次的迟到结果直接丢弃。
        setCache((old) =>
          old.token === token
            ? { token, map: new Map(old.map).set(entry.path, resource) }
            : old,
        );
      };
      void props.browser
        .readProjectDiff({
          cwd: info.root,
          base: info.base,
          file: {
            name: entry.name,
            path: entry.path,
            kind: entry.kind,
            change: entry.change,
            previousPath: entry.previousPath,
          },
        })
        .then(
          (value) => settle({ status: "ready", value }),
          (error: unknown) =>
            settle({
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            }),
        );
    }
  });

  // ---- 目录栏 ----
  const treeContext: ProjectTreeContext = {
    browser: props.browser,
    revision: props.revision,
    files,
    selected: current,
    collapsed: collapsedDirs,
    expanded: NO_EXPANDED,
    onToggle: (path, open) => {
      const key = treePath(path);
      setCollapsedDirs((old) =>
        new Set(
          !open ? [...old].filter((item) => item !== key) : [...old, key],
        ),
      );
    },
    onSelect: showFile,
    onFileMenu: menu.openMenu,
  };

  function content() {
    if (state.status === "loading")
      return <p role="status">正在读取项目变更…</p>;
    if (state.status === "error") return <p role="alert">{state.error}</p>;
    if (info?.kind !== "git")
      return <p className="code-review-empty">非 Git 项目，无 Git 差异</p>;
    return (
      <>
        {state.refreshing && <p role="status">正在刷新项目变更…</p>}
        {state.error && <p role="alert">刷新失败：{state.error}</p>}
        {!files.length ? (
          <div className="code-review-empty">
            <strong>没有变更</strong>
            <p>当前来源「未提交」下没有变更。</p>
            <button type="button" onClick={props.onShowFiles}>
              查看文件
            </button>
          </div>
        ) : !ordered.length ? (
          <p className="code-review-empty">没有匹配的变更文件</p>
        ) : (
          ordered.map((entry) => (
            <ChangeFileSection
              key={entry.path}
              entry={entry}
              base={info.base}
              collapsed={
                props.collapsed.has(entry.path) && !isForced(entry.path)
              }
              resource={resources.get(entry.path)}
              layout={props.layout}
              wrap={props.wrap}
              revealTarget={isForced(entry.path)}
              onToggle={props.onToggleSection}
              onOpenInFiles={props.onOpenInFiles}
              onMenu={menu.openMenu}
              register={register}
            />
          ))
        )}
      </>
    );
  }

  return (
    <div className="code-review-changes">
      <div className="code-review-toolbar">
        <span>
          <em className="change-source-pill" title="变更来源" aria-label="变更来源：未提交">
            未提交
          </em>
        </span>
        <ReviewIconButton
          icon="refresh"
          tooltip="刷新变更与差异"
          aria-label="刷新变更与差异"
          onClick={props.onRefresh}
        />
        <ReviewIconButton
          icon="wrap"
          aria-label="自动换行"
          tooltip={props.wrap ? "关闭自动换行" : "开启自动换行"}
          aria-pressed={props.wrap}
          onClick={props.onToggleWrap}
        />
        <ReviewIconButton
          icon={allCollapsed ? "expandAll" : "collapseAll"}
          aria-label={allCollapsed ? "展开所有文件" : "折叠所有文件"}
          tooltip={allCollapsed ? "展开所有文件的差异" : "折叠所有文件的差异"}
          aria-pressed={allCollapsed}
          aria-disabled={!files.length || undefined}
          onClick={() => {
            if (files.length)
              props.onToggleAll(
                files.map((file) => file.path),
                !allCollapsed,
              );
          }}
        />
        <ReviewIconButton
          icon={<LayoutIcon layout={props.layout} />}
          aria-label={`差异布局：${props.layout === "split" ? "并排" : "单栏"}`}
          data-diff-layout={props.layout}
          tooltip={
            props.layout === "split"
              ? "并排 Diff；点击切换为单栏 Diff"
              : "单栏 Diff；点击切换为并排 Diff"
          }
          onClick={props.onToggleLayout}
        />
        <ReviewIconButton
          icon={props.filesVisible ? "collapse" : "expand"}
          tooltip={props.filesVisible ? "收起变更目录栏" : "展开变更目录栏"}
          aria-label="显示变更目录"
          aria-pressed={props.filesVisible}
          onClick={props.onToggleFiles}
        />
      </div>
      <div className="code-review-body">
        <div
          className="code-review-files code-review-changes-nav"
          hidden={!props.filesVisible}
        >
          <PaneResizeHandle
            storageKey="omp-desktop.file-tree-width"
            label="调整文件目录宽度"
            edge="right"
            initialWidth={220}
            minWidth={120}
            reserve={180}
          />
          <aside ref={navRoot} className="project-files" aria-label="变更文件目录">
            <input
              aria-label="筛选变更文件"
              placeholder="筛选文件…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <nav aria-label="变更文件列表">
              <button
                className="project-tree-root"
                aria-expanded={rootOpen}
                onClick={() => setRootOpen(!rootOpen)}
              >
                <TreeChevron open={rootOpen} />
                已更改的文件
              </button>
              {rootOpen && <TreeNodes nodes={nodes} context={treeContext} depth={0} />}
              {files.length > 0 && !nodes.length && <p>没有匹配的变更文件</p>}
            </nav>
            {active && <LocalSourceMarkers root={navRoot} view="path" />}
            {menu.menuError && <p role="alert">{menu.menuError}</p>}
            {menu.menuNode}
          </aside>
        </div>
        <div
          ref={scroller}
          className="code-review-changes-scroll"
          aria-label="变更差异"
          tabIndex={0}
        >
          {content()}
        </div>
      </div>
    </div>
  );
}
