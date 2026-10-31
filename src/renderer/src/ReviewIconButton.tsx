import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

const paths = {
  refresh: "M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 7l-3 3",
  maximize: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  minimize: "M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5",
  close: "m6 6 12 12M6 18 18 6",
  collapse: "M3 4h18v16H3ZM9 4v16m8-12-4 4 4 4",
  expand: "M3 4h18v16H3ZM9 4v16m4-12 4 4-4 4",
  wrap: "M3 6h18M3 11h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 16h4",
  changes:
    "M6 2.5h12a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-13a3 3 0 0 1 3-3ZM9 8h6m-3-3v6m-3 6h6",
  files:
    "M8 7V5a2 2 0 0 1 2-2h4l3 2h3a2 2 0 0 1 2 2v10M4 7h5l3 3h5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
  directory: "M3 5h6l3 3h9v13H3ZM9 14h6m-3-3 3 3-3 3",
  external:
    "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  collapseAll: "M4 3h16M4 21h16m-12-14 4 4 4-4m-8 10 4-4 4 4",
  expandAll: "M4 12h16M8 7l4-4 4 4M8 17l4 4 4-4",
  preview:
    "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: keyof typeof paths | ReactElement;
  readonly tooltip: string;
  readonly "aria-label": string;
}

/** 图标按钮同时支持悬停与键盘聚焦提示，移开鼠标时保留焦点提示。 */
export function ReviewIconButton({ icon, tooltip, children, ...props }: Props) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const visible = hovered || focused;
  return (
    <button
      {...props}
      type="button"
      className="review-icon-button"
      aria-describedby={visible ? id : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {typeof icon === "string" ? <path d={paths[icon]} /> : icon}
      </svg>
      {children}
      {visible && (
        <span id={id} role="tooltip" className="review-icon-tooltip">
          {tooltip}
        </span>
      )}
    </button>
  );
}
