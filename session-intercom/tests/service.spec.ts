import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionController, type ApiSessionAgentResult } from '@deepseek-ai/dsh-api-session-controller'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type Session, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionProjectionCache } from '@deepseek-ai/dsh-session-projection-cache'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionRecord, SessionResultFilter } from '@deepseek-ai/dsh-session-query'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import SessionIntercom, { IntercomError, type Config as IntercomConfig } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

const TITLE_CONFIG = { fallbackMaxWords: 8, fallbackMaxBytes: 96, maxTitleBytes: 120 }

class FakeQuery extends SessionQueryEngine {
  static records: SessionRecord[] = []

  override listSessions(): Promise<SessionRecord[]> {
    return Promise.resolve(FakeQuery.records)
  }

  override filterSessions(filters: readonly SessionResultFilter[]): Promise<SessionRecord[]> {
    const ids = new Set(filters.flatMap(filter => filter.kind === 'id' ? filter.values : []))
    return Promise.resolve(FakeQuery.records.filter(record => ids.size === 0 || ids.has(record.header.id)))
  }

  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}

const contexts: Context[] = []

afterEach(async () => {
  FakeQuery.records = []
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(config: IntercomConfig = {}): Promise<{
  ctx: Context
  caller: Agent
  target: Agent
  intercom: SessionIntercom
  intercomFiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionTitle, TITLE_CONFIG)
  await ctx.plugin(FakeQuery)
  const harness = await mountAgentLoopTestHarness(ctx)
  const intercomFiber = await ctx.plugin(SessionIntercom, config)
  const intercom = ctx.intercom
  const caller = await harness.create(SessionId('caller'), {}, { cwd: '/work' })
  const target = await harness.create(SessionId('target'), {}, { cwd: '/work' })
  return { ctx, caller, target, intercom, intercomFiber }
}

function record(session: Session, live = true): SessionRecord {
  return { header: session.header, live, persisted: true }
}

function title(session: Session, text: string): void {
  session.append('session/title', { title: text, messageSeqs: [], source: { kind: 'user' } })
}

function peerIds(result: { peers: readonly { sessionId: string }[] }): string[] {
  return result.peers.map(peer => peer.sessionId)
}

function headerOf(id: string, cwd?: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1,
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
  }
}

function provideController(ctx: Context, resolve: (sessionId: SessionId) => Promise<ApiSessionAgentResult>): () => void {
  const controller = Object.create(SessionController.prototype) as SessionController
  controller.resolveAgent = resolve
  return ctx.provide('sessionController', controller)
}

function fakeAgentOf(agent: Agent, session: Session, followup: (message: unknown) => void): Agent {
  const fake = Object.create(agent) as Agent
  Object.defineProperty(fake, 'id', { value: session.id })
  Object.defineProperty(fake, 'session', { value: session })
  Object.defineProperty(fake, 'followup', { value: followup })
  return fake
}

function projection(title: string | null): ProjectionSnapshot {
  return { asOfSeq: SessionSeq(0), values: { title } }
}

describe('session intercom listing', () => {
  it('lists visible peers with titles and never includes the caller or subagent sessions', async () => {
    const { ctx, caller, target, intercom } = await setup()
    title(caller.session, 'Caller session')
    title(target.session, 'Target session')
    const cold = ctx.sessions.create(SessionId('cold'), { meta: { cwd: '/other' } })
    const noCwd = ctx.sessions.create(SessionId('no-cwd'))
    const subagent = ctx.sessions.create(SessionId('sub'), { meta: { origin: 'subagent', cwd: '/work' } })
    FakeQuery.records = [
      record(caller.session), record(target.session), record(cold, false), record(noCwd), record(subagent),
    ]

    const listing = await intercom.list(caller)
    expect(peerIds(listing)).toEqual(['target', 'cold', 'no-cwd'])
    expect(listing.truncated).toBe(false)
    expect(listing.peers[0]).toMatchObject({
      sessionId: 'target', title: 'Target session', live: true, workspace: '/work',
    })
    expect(listing.peers[1]).toMatchObject({ sessionId: 'cold', title: 'untitled', live: false, workspace: '/other' })
    expect(listing.peers[2]).toEqual({ sessionId: 'no-cwd', title: 'untitled', live: true })
  })

  it('reads a cold title from the projection cache and falls back for missing or empty rows', async () => {
    const { ctx, caller, intercom } = await setup()
    const cold = ctx.sessions.create(SessionId('cold'), { meta: { cwd: '/work' } })
    const cache = Object.create(SessionProjectionCache.prototype) as SessionProjectionCache
    cache.cachedSnapshot = header => header.id === 'cold' ? undefined : projection(header.id === 'empty' ? null : 'Cached title')
    cache.cachedPredecessorTitle = header => header.id === 'cold' ? projection('Predecessor title') : undefined
    ctx.provide('sessionProjectionCache', cache)
    FakeQuery.records = [
      record(caller.session),
      record(cold, false),
      { header: headerOf('ghost'), live: true, persisted: true },
      { header: headerOf('empty'), live: false, persisted: true },
    ]

    const listing = await intercom.list(caller)
    expect(listing.peers).toEqual([
      { sessionId: 'cold', title: 'Predecessor title', live: false, workspace: '/work' },
      { sessionId: 'ghost', title: 'Cached title', live: true },
      { sessionId: 'empty', title: 'untitled', live: false },
    ])
  })

  it('filters by title or id and reports a truncated page', async () => {
    const { ctx, caller, target, intercom } = await setup({ maxPeers: 1 })
    title(target.session, 'Deployment notes')
    const other = await ctx.agentLoop.create(SessionId('other'), {}, { cwd: '/work' })
    title(other.session, 'Unrelated')
    FakeQuery.records = [record(caller.session), record(target.session), record(other.session)]

    expect(peerIds(await intercom.list(caller, 'deploy'))).toEqual(['target'])
    expect(peerIds(await intercom.list(caller, 'other'))).toEqual(['other'])
    const page = await intercom.list(caller)
    expect(page.peers).toHaveLength(1)
    expect(page.truncated).toBe(true)
  })

  it('applies denied, allowed, and same-workspace rules to discovery and sending', async () => {
    const { ctx, caller, target, intercom } = await setup({
      deniedSessionIds: ['target'],
      sameWorkspaceOnly: true,
    })
    const elsewhere = ctx.sessions.create(SessionId('elsewhere'), { meta: { cwd: '/elsewhere' } })
    FakeQuery.records = [record(caller.session), record(target.session), record(elsewhere)]

    expect(peerIds(await intercom.list(caller))).toEqual([])
    const denied = await intercom.send(caller, { to: target.id, text: 'hello' }).catch(error => error)
    expect(denied).toBeInstanceOf(IntercomError)
    expect(denied.code).toBe('INTERCOM_UNAUTHORIZED')

    const allowedConfig = await setup({
      allowedSessionIds: ['target'],
      sameWorkspaceOnly: true,
    })
    title(allowedConfig.target.session, 'Target')
    const omitted = allowedConfig.ctx.sessions.create(SessionId('omitted'), { meta: { cwd: '/work' } })
    FakeQuery.records = [
      record(allowedConfig.caller.session), record(allowedConfig.target.session), record(omitted),
    ]
    expect(peerIds(await allowedConfig.intercom.list(allowedConfig.caller))).toEqual(['target'])
    await expect(allowedConfig.intercom.send(allowedConfig.caller, { to: allowedConfig.target.id, text: 'ok' }))
      .resolves.toMatchObject({ target: { sessionId: 'target' } })

    const crossWorkspace = await setup({ sameWorkspaceOnly: true })
    const remote = crossWorkspace.ctx.sessions.create(SessionId('remote'), { meta: { cwd: '/remote' } })
    FakeQuery.records = [record(crossWorkspace.caller.session), record(remote)]
    expect(peerIds(await crossWorkspace.intercom.list(crossWorkspace.caller))).toEqual([])
  })
})

describe('session intercom sending', () => {
  it('delivers a framed user message into the target inbox without reading its history', async () => {
    const { caller, target, intercom } = await setup()
    title(caller.session, 'Caller session')
    FakeQuery.records = [record(caller.session), record(target.session)]

    const followup = vi.spyOn(target, 'followup')
    const result = await intercom.send(caller, { to: target.id, text: 'Please review the diff.' })
    expect(result.target).toMatchObject({ sessionId: 'target', title: 'untitled', live: true, workspace: '/work' })
    expect(followup).toHaveBeenCalledTimes(1)
    const delivered = followup.mock.calls[0]?.[0]
    expect(delivered?.id).toBe(result.messageId)
    expect(delivered?.source).toEqual({ kind: 'agent-message', form: 'relay', senderSessionId: 'caller' })
    expect(delivered?.content).toEqual([{
      type: 'text',
      text: '[Intercom message from session "Caller session" (caller), not the user]\nPlease review the diff.',
    }])
  })

  it('rejects self, empty, oversized, unknown, and subagent targets', async () => {
    const { ctx, caller, intercom } = await setup({ maxMessageBytes: 4 })
    const subagent = ctx.sessions.create(SessionId('sub'), { meta: { origin: 'subagent', cwd: '/work' } })
    FakeQuery.records = [record(caller.session), record(subagent)]

    const failures = await Promise.all([
      intercom.send(caller, { to: caller.id, text: 'x' }).catch(error => error),
      intercom.send(caller, { to: SessionId('missing'), text: 'x' }).catch(error => error),
      intercom.send(caller, { to: subagent.id, text: 'x' }).catch(error => error),
      intercom.send(caller, { to: subagent.id, text: '   ' }).catch(error => error),
      intercom.send(caller, { to: subagent.id, text: 'too large' }).catch(error => error),
    ])
    expect(failures.map(error => error.code)).toEqual([
      'INTERCOM_SELF_MESSAGE',
      'INTERCOM_UNKNOWN_SESSION',
      'INTERCOM_SUBAGENT_TARGET',
      'INTERCOM_MESSAGE_EMPTY',
      'INTERCOM_MESSAGE_TOO_LARGE',
    ])
  })

  it('rejects a stored target when this host cannot activate it', async () => {
    const { ctx, caller, intercom } = await setup()
    const stored = ctx.sessions.create(SessionId('stored'), { meta: { cwd: '/work' } })
    FakeQuery.records = [record(caller.session), record(stored, false)]
    const error = await intercom.send(caller, { to: stored.id, text: 'hello' }).catch(value => value)
    expect(error).toBeInstanceOf(IntercomError)
    expect(error.code).toBe('INTERCOM_TARGET_INACTIVE')
  })
})

  it('omits workspace metadata for a target without a recorded directory', async () => {
    const { ctx, caller, intercom } = await setup()
    const target = await ctx.agentLoop.create(SessionId('no-cwd'), {}, {})
    const followup = vi.spyOn(target, 'followup')
    FakeQuery.records = [record(caller.session), record(target.session)]
    const result = await intercom.send(caller, { to: target.id, text: 'hello' })
    expect(result.target).toEqual({ sessionId: 'no-cwd', title: 'untitled', live: true })
    expect(followup.mock.calls.length).toBe(1)
  })

  it('reports a target that rejects inbox admission', async () => {
    const { caller, target, intercom } = await setup()
    FakeQuery.records = [record(caller.session), record(target.session)]
    vi.spyOn(target, 'followup').mockImplementation(() => { throw new Error('closed') })
    const error = await intercom.send(caller, { to: target.id, text: 'hello' }).catch(value => value)
    expect(error).toBeInstanceOf(IntercomError)
    expect(error.code).toBe('INTERCOM_TARGET_UNAVAILABLE')
  })

  it('activates a stored target through the optional session controller', async () => {
    const { ctx, caller, target, intercom } = await setup()
    const stored = ctx.sessions.create(SessionId('stored'), { meta: { cwd: '/work' } })
    const followup = vi.fn()
    const activated = fakeAgentOf(target, stored, followup)
    provideController(ctx, async () => ({ agent: activated }))
    FakeQuery.records = [record(caller.session), record(stored, false)]
    const result = await intercom.send(caller, { to: stored.id, text: 'hello' })
    expect(result.target).toMatchObject({ sessionId: 'stored', live: true, workspace: '/work' })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('rejects a controller that fails or resolves another session', async () => {
    const { ctx, caller, target, intercom } = await setup()
    const stored = ctx.sessions.create(SessionId('stored'), { meta: { cwd: '/work' } })
    FakeQuery.records = [record(caller.session), record(stored, false)]

    const controller = Object.create(SessionController.prototype) as SessionController
    controller.resolveAgent = async () => ({ agent: target })
    ctx.provide('sessionController', controller)
    const mismatch = await intercom.send(caller, { to: stored.id, text: 'hello' }).catch(value => value)
    expect(mismatch.code).toBe('INTERCOM_TARGET_UNAVAILABLE')

    controller.resolveAgent = async () => { throw new Error('activation failed') }
    const failure = await intercom.send(caller, { to: stored.id, text: 'hello' }).catch(value => value)
    expect(failure.code).toBe('INTERCOM_TARGET_UNAVAILABLE')

    controller.resolveAgent = async () => ({ error: new Error('denied') as never })
    const denied = await intercom.send(caller, { to: stored.id, text: 'hello' }).catch(value => value)
    expect(denied.code).toBe('INTERCOM_TARGET_UNAVAILABLE')
  })

describe('session intercom tools', () => {
  it('exposes listing and sending through the tool pipeline', async () => {
    const { ctx, caller, target, intercom } = await setup()
    title(caller.session, 'Caller')
    title(target.session, 'Target')
    FakeQuery.records = [record(caller.session), record(target.session)]

    const listDefinition = ctx.tools.get('intercom_list')
    expect(listDefinition?.isConcurrencySafe?.({})).toBe(true)
    expect(listDefinition?.presentCall?.({})).toMatchObject({ card: 'generic', title: 'intercom_list' })
    const sendDefinition = ctx.tools.get('intercom_send')
    expect(sendDefinition?.presentCall?.({ session_id: 'target', text: 'hello' }))
      .toMatchObject({ card: 'generic', title: 'Send intercom message' })

    const noCwd = await ctx.agentLoop.create(SessionId('no-cwd'), {}, {})
    FakeQuery.records = [record(caller.session), record(target.session), record(noCwd.session)]

    const listed = await executeToolFixture(ctx, {
      name: 'intercom_list',
      callId: ToolCallId('list-1'),
      arguments: {},
      agent: caller,
      signal: new AbortController().signal,
    })
    expect(listed.isError).not.toBe(true)
    expect(JSON.parse(JSON.stringify(listed.value))).toEqual({
      peers: [
        { session_id: 'target', title: 'Target', live: true, workspace: '/work' },
        { session_id: 'no-cwd', title: 'untitled', live: true },
      ],
      truncated: false,
    })

    const followup = vi.spyOn(target, 'followup')
    const sent = await executeToolFixture(ctx, {
      name: 'intercom_send',
      callId: ToolCallId('send-1'),
      arguments: { session_id: 'target', text: 'hello' },
      agent: caller,
      signal: new AbortController().signal,
    })
    expect(sent.isError).not.toBe(true)
    expect(JSON.parse(JSON.stringify(sent.value))).toMatchObject({ target_session_id: 'target', target_title: 'Target' })
    expect(followup.mock.calls.length).toBe(1)
  })

  it('reports tool failures for empty ids and missing callers', async () => {
    const { ctx, caller } = await setup()
    const empty = await executeToolFixture(ctx, {
      name: 'intercom_send',
      callId: ToolCallId('send-empty'),
      arguments: { session_id: ' ', text: 'hello' },
      agent: caller,
      signal: new AbortController().signal,
    })
    expect(empty.isError).toBe(true)
    expect(empty.content[0]).toMatchObject({ type: 'text' })

    const agentless = await executeToolFixture(ctx, {
      name: 'intercom_list',
      callId: ToolCallId('list-agentless'),
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(agentless.isError).toBe(true)
  })
})

describe('session intercom configuration', () => {
  it('rejects invalid bounds and duplicate or malformed ids', () => {
    expect(() => resolveConfig({ maxMessageBytes: 0 })).toThrow(IntercomError)
    expect(() => resolveConfig({ maxPeers: 0 })).toThrow(IntercomError)
    expect(() => resolveConfig({ allowedSessionIds: ['a', 'a'] })).toThrow(IntercomError)
    expect(() => resolveConfig({ deniedSessionIds: [' a'] })).toThrow(IntercomError)
  })

  it('accepts omitted values and normalizes explicit ids', () => {
    expect(resolveConfig()).toMatchObject({ maxMessageBytes: 65_536, maxPeers: 100, sameWorkspaceOnly: false })
    expect(resolveConfig({ allowedSessionIds: ['a'], deniedSessionIds: ['b'] })).toMatchObject({
      allowedSessionIds: new Set(['a']),
      deniedSessionIds: new Set(['b']),
    })
  })

  it('registers the service and tools as one plugin fiber', async () => {
    const { ctx } = await setup()
    expect(ctx.intercom).toBeInstanceOf(SessionIntercom)
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['intercom_list', 'intercom_send']))
  })

  it('unregisters its tools when the plugin fiber is disposed', async () => {
    const { ctx, intercomFiber } = await setup()
    expect(ctx.tools.get('intercom_list')).toBeDefined()
    await intercomFiber.dispose()
    expect(ctx.tools.get('intercom_list')).toBeUndefined()
    expect(ctx.tools.get('intercom_send')).toBeUndefined()
  })
})
