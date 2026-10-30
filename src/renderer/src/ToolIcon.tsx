/** 根据操作动词显示线条图标，未知工具使用通用图标，文字仍负责表达含义。 */
export function ToolIcon({ verb }: { verb: string }) {
  const paths: Record<string, string> = {
    读取: "M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3V4Zm9 2v15M6 8h3M6 11h3m6-3h3m-3 3h3",
    写入: "M13 4H5v16h14v-8M14 3l7 7M10 14l2-5 6-6 4 4-6 6-6 1Z",
    编辑: "m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4",
    执行命令:
      "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 5 4 4-4 4m6 0h4",
    搜索: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
    查找文件:
      "M13 3H4v18h16V10l-7-7Zm0 0v7h7M8 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm2 5 3 3",
    搜索网页:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c-5 5-5 15 0 20 5-5 5-15 0-20ZM2 12h20",
  };
  return (
    <svg
      className="tool-operation-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[verb] ?? "m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8m-9 5v9"}
      />
    </svg>
  );
}
