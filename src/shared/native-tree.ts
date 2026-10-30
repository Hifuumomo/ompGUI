/** 未提供摘要选项时，回退选择始终保持不生成摘要。 */
export interface TreeNavigationOptions {
  readonly summarize?: boolean;
  readonly askSummary?: boolean;
}
