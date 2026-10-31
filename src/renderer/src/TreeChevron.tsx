/**
 * 文件树目录行、根节点与变更区块标题行共用的折叠箭头。
 * 路径与文件菜单子菜单的箭头一致；展开时由样式旋转 90°。
 * @param open [in] 是否处于展开状态。
 * @returns 与文件图标同宽的箭头图形，对辅助技术隐藏。
 */
export function TreeChevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      className="tree-chevron"
      data-open={open}
      width="18"
      height="18"
      viewBox="-1 -1 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}
