/** 将毫秒用时按最高非零单位展开，保留低位单位，不附加场景文案。 */
export function durationText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const units = [
    [86400, "天"],
    [3600, "小时"],
    [60, "分"],
    [1, "秒"],
  ] as const;
  let remaining = seconds;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const value = Math.floor(remaining / size);
    remaining %= size;
    if (value || parts.length || size === 1) parts.push(`${value}${label}`);
  }
  return parts.join("");
}
