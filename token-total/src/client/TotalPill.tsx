import { memo, type ReactElement } from 'react'

/** 与 ui-chat 相同的计费口径：所有计入输入的桶加上输出。 */
export function billedInputTokens(usage: {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** 把大数压成 1.2M 这样的短形。 */
export function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

/** 本机所有会话累计 tokens 的读数；零时不占位。 */
export const TotalPill = memo(function TotalPill(props: {
  useTotalTokens: (selector: (value: number) => number) => number
  t: (key: 'tokenTotal', vars: { count: string }) => string
}): ReactElement | null {
  const total = props.useTotalTokens(value => value)
  if (total === 0) return null
  return <span data-composer-stat="token-total">{props.t('tokenTotal', { count: compactTokens(total) })}</span>
})
