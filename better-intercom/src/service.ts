/** Cross-session explicit messaging without transcript reads. @module @deepseek-ai/dsh-experimental-session-intercom */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-subagent'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { Config as ConfigSchema, resolveConfig, type Config, type ResolvedConfig } from './config.ts'
import { IntercomError } from './error.ts'
import { registerTools } from './tools.ts'
import type { IntercomListing, IntercomPeer, RelayIntercomRequest, SendIntercomRequest, SendIntercomResult } from './types.ts'

export { Config } from './config.ts'
export type { Config as IntercomConfig } from './config.ts'
export { IntercomError } from './error.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Explicit peer messaging across the Sessions of one DSH host. */
    intercom: SessionIntercom
  }
}

const UNTITLED = 'untitled'

/** Explicit peer messaging over Session inboxes; it never reads another Session's log. */
export class SessionIntercom extends Service {
  static inject = ['agents', 'sessions', 'sessionQuery', 'sessionProjections', 'tools', 'systemPrompt']

  static Config: z<Config> = ConfigSchema

  private readonly config: ResolvedConfig
  private externalResolver: ((sessionId: SessionId) => Promise<Agent>) | undefined

  /**
   * @param ctx - host context carrying agents, Sessions, query, projections, and tools.
   * @param config - deployment access rules and message bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'intercom')
    this.config = resolveConfig(config)
  }

  protected async [Service.init](): Promise<void> {
    this.ctx.inject(['sessionController'], (webCtx) => {
      webCtx.effect(() => {
        const controller = webCtx.sessionController
        this.externalResolver = async (sessionId) => {
          const resolved = await controller.resolveAgent(sessionId)
          if ('error' in resolved) throw resolved.error
          return resolved.agent
        }
        return () => { this.externalResolver = undefined }
      })
    })
    registerTools(this.ctx, this)
  }

  /**
   * List other Sessions the caller may message. Results carry titles and availability only.
   * @param caller - exact live Agent whose identity and permissions bound the listing.
   * @param query - optional case-insensitive substring matched against title or session id.
   * @param signal - optional cancellation for the underlying session listing.
   * @returns visible peers, newest first, and whether the configured page was truncated.
   */
  async list(caller: Agent, query?: string, signal?: AbortSignal): Promise<IntercomListing> {
    const records = await this.ctx.sessionQuery.listSessions(signal)
    const needle = query?.trim().toLowerCase() ?? ''
    const peers: IntercomPeer[] = []
    let truncated = false
    for (const record of records) {
      const header = record.header
      if (header.id === caller.id) continue
      if (header.origin === 'subagent') continue
      if (!this.authorized(caller, header)) continue
      const title = this.titleOfRecord(record)
      if (needle.length > 0 && !title.toLowerCase().includes(needle) && !header.id.toLowerCase().includes(needle)) continue
      if (peers.length === this.config.maxPeers) {
        truncated = true
        break
      }
      peers.push({
        sessionId: header.id,
        title,
        live: record.live,
        ...header.cwd === undefined ? {} : { workspace: header.cwd },
      })
    }
    return {
      self: { sessionId: caller.id, title: this.titleOf(caller.session) },
      peers,
      truncated,
    }
  }

  /**
   * Deliver one explicit message to another Session's inbox.
   * @param caller - exact live Agent whose identity and permissions bound the send.
   * @param request - target Session and message body.
   * @param signal - optional cancellation checked before and after target activation.
   * @returns the accepted message identity and target metadata.
   * @throws {IntercomError} when the target is missing, unauthorized, self, inactive, or oversized.
   */
  async send(caller: Agent, request: SendIntercomRequest, signal?: AbortSignal): Promise<SendIntercomResult> {
    const callerTitle = this.titleOf(caller.session)
    const text = `[Intercom message from session ${JSON.stringify(callerTitle)} (${caller.id}), not the user]\n${request.text}`
    return this.deliver(caller, request.to, text, signal)
  }

  /**
   * Relay a pure-information summary to another Session without sender framing.
   *
   * The direct message above carries the sender's title and id; receivers tend to weigh
   * the source instead of the content. This path deliberately drops both from the visible
   * text and keeps only reproducible evidence, so the receiver judges the information on
   * its merits. Sender identity still lands in the message source for audit.
   *
   * @param caller - sending Agent; identity still bounds authorization.
   * @param request - target, summary, optional reproducible evidence.
   * @param signal - optional cancellation checked before delivery.
   * @returns the accepted message identity and target metadata.
   */
  async relay(caller: Agent, request: RelayIntercomRequest, signal?: AbortSignal): Promise<SendIntercomResult> {
    const summary = request.summary.trim()
    const evidence = request.evidence?.trim()
    if (summary.length === 0) {
      throw new IntercomError('INTERCOM_MESSAGE_EMPTY', 'summary must not be empty')
    }
    const text = evidence === undefined || evidence.length === 0
      ? summary
      : summary + '\n\nEvidence: ' + evidence
    return this.deliver(caller, request.to, '[Intercom relay]\n' + text, signal)
  }

  /**
   * Shared delivery path: both direct messages and relays pass every authorization and
   * bound check here, so a new envelope kind cannot accidentally skip them.
   * @param caller - sending Agent.
   * @param to - target Session id, which must not be the caller.
   * @param text - fully rendered message body.
   * @param signal - optional cancellation.
   * @returns the accepted message identity and target metadata.
   */
  private async deliver(caller: Agent, to: SessionId, text: string, signal?: AbortSignal): Promise<SendIntercomResult> {
    signal?.throwIfAborted()
    if (to === caller.id) {
      throw new IntercomError('INTERCOM_SELF_MESSAGE', 'a Session cannot message itself')
    }
    if (text.trim().length === 0) {
      throw new IntercomError('INTERCOM_MESSAGE_EMPTY', 'message text must not be empty')
    }
    if (Buffer.byteLength(text, 'utf8') > this.config.maxMessageBytes) {
      throw new IntercomError(
        'INTERCOM_MESSAGE_TOO_LARGE',
        `message exceeds ${this.config.maxMessageBytes} UTF-8 bytes`,
      )
    }
    const records = await this.ctx.sessionQuery.filterSessions([{ kind: 'id', values: [to] }], signal)
    const record = records[0]
    if (records.length !== 1 || record === undefined) {
      throw new IntercomError('INTERCOM_UNKNOWN_SESSION', `session "${to}" does not exist`)
    }
    const header = record.header
    if (header.origin === 'subagent') {
      throw new IntercomError('INTERCOM_SUBAGENT_TARGET', `session "${to}" is owned by subagent routing`)
    }
    if (!this.authorized(caller, header)) {
      throw new IntercomError('INTERCOM_UNAUTHORIZED', `session "${to}" is not visible to the caller`)
    }
    const target = await this.resolveTarget(to)
    signal?.throwIfAborted()
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'agent-message', form: 'relay', senderSessionId: caller.id },
    })
    try {
      target.followup(message)
    } catch (error: unknown) {
      throw new IntercomError('INTERCOM_TARGET_UNAVAILABLE', `session "${to}" did not accept the message`, { cause: error })
    }
    return {
      messageId: message.id,
      target: {
        sessionId: to,
        title: this.titleOf(target.session),
        live: true,
        ...header.cwd === undefined ? {} : { workspace: header.cwd },
      },
    }
  }

  private authorized(caller: Agent, target: SessionHeader): boolean {
    if (this.config.deniedSessionIds.has(target.id)) return false
    if (this.config.allowedSessionIds.size > 0 && !this.config.allowedSessionIds.has(target.id)) return false
    if (!this.config.sameWorkspaceOnly) return true
    const source = caller.session.header.cwd
    const destination = target.cwd
    return source !== undefined && destination !== undefined && source === destination
  }

  private async resolveTarget(sessionId: SessionId): Promise<Agent> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const resolver = this.externalResolver
    if (resolver === undefined) {
      throw new IntercomError(
        'INTERCOM_TARGET_INACTIVE',
        `session "${sessionId}" has no live agent and this host cannot activate stored sessions`,
      )
    }
    try {
      const resolved = await resolver(sessionId)
      if (resolved.id !== sessionId) {
        throw new IntercomError('INTERCOM_TARGET_UNAVAILABLE', `activation resolved a different session`)
      }
      return resolved
    } catch (error: unknown) {
      throw new IntercomError('INTERCOM_TARGET_UNAVAILABLE', `session "${sessionId}" could not be activated`, { cause: error })
    }
  }

  private titleOf(session: Session): string {
    const title = this.ctx.sessionProjections.snapshot(session, ['title']).values.title
    return typeof title === 'string' && title.trim().length > 0 ? title : UNTITLED
  }

  private titleOfRecord(record: SessionRecord): string {
    if (record.live) {
      const session = this.ctx.sessions.get(record.header.id)
      if (session !== undefined) return this.titleOf(session)
    }
    const cache = this.ctx.get('sessionProjectionCache')
    if (cache === undefined) return UNTITLED
    const snapshot = cache.cachedSnapshot(record.header, ['title']) ?? cache.cachedPredecessorTitle(record.header)
    const title = snapshot?.values.title
    return typeof title === 'string' && title.trim().length > 0 ? title : UNTITLED
  }
}

export default SessionIntercom
