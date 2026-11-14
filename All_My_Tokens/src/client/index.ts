/**
 * 全局 token 合计 pill：在输入框底部显示本机所有会话累计的 tokens。
 *
 * 数据来源是每个会话摘要里 durable 的 tokenUsage 投影，客户端本地求和，
 * 不额外请求 Host。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TotalPill, billedInputTokens } from './TotalPill.tsx'
import { NS, zh, en } from './locales.ts'

/** 需要会话列表、插槽注册表与词典。 */
export const inject = ['sessions', 'slots', 'locale']

/**
 * 注册词典与输入框底部的总计 pill。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-total: dictionaries')

  const totalTokens = createSnapshotStore(0)
  const recompute = (): void => {
    let sum = 0
    for (const summary of Object.values(ctx.sessions.list.getSnapshot().byId)) {
      const usage = summary.projectionValues?.tokenUsage
      if (usage === undefined) continue
      sum += billedInputTokens(usage) + usage.outputTokens
    }
    totalTokens.set(sum)
  }
  ctx.effect(() => {
    const stop = ctx.sessions.list.subscribe(recompute)
    recompute()
    return stop
  }, 'token-total: global sum')

  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'token-total',
      order: 2,
      locale: NS,
      inject: () => ({ hooks: { totalTokens } }),
    }, TotalPill))
}
