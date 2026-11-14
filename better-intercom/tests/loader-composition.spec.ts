import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionRecord, SessionResultFilter } from '@deepseek-ai/dsh-session-query'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionIntercom from '../src/index.ts'

class LoaderQuery extends SessionQueryEngine {
  static records: SessionRecord[] = []

  override listSessions(): Promise<SessionRecord[]> {
    return Promise.resolve(LoaderQuery.records)
  }

  override filterSessions(filters: readonly SessionResultFilter[]): Promise<SessionRecord[]> {
    const ids = new Set(filters.flatMap(filter => filter.kind === 'id' ? filter.values : []))
    return Promise.resolve(LoaderQuery.records.filter(record => ids.has(record.header.id)))
  }

  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  LoaderQuery.records = []
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('session intercom through a real Loader composition', () => {
  it('lists and messages another Session through the loaded plugin tree', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-intercom-'))
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-executor-native', NativeToolExecutor],
      ['@deepseek-ai/dsh-session-query', LoaderQuery],
      ['@deepseek-ai/dsh-session-title', SessionTitle],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-experimental-session-intercom', SessionIntercom],
    ])
    const config = [...modules.keys()].flatMap(name => [
      `- name: 'cordis:${name}'`,
      ...name === '@deepseek-ai/dsh-agent-loop' ? ['  config:', '    agents: []'] : [],
      ...name === '@deepseek-ai/dsh-session-title' ? [
        '  config:',
        '    fallbackMaxWords: 8',
        '    fallbackMaxBytes: 96',
        '    maxTitleBytes: 120',
      ] : [],
    ]).join('\n') + '\n'
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, config)

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    for (const [specifier, plugin] of modules) context.loader.builtins[specifier] = plugin
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const caller = await context.agentLoop.create(SessionId('loader-caller'), {}, { cwd: '/work' })
    const target = await context.agentLoop.create(SessionId('loader-target'), {}, { cwd: '/work' })
    caller.session.append('session/title', { title: 'Loader caller', messageSeqs: [], source: { kind: 'user' } })
    target.session.append('session/title', { title: 'Loader target', messageSeqs: [], source: { kind: 'user' } })
    LoaderQuery.records = [caller.session, target.session].map(session => ({
      header: session.header, live: true, persisted: true,
    }))

    const listed = await executeToolFixture(context, {
      name: 'intercom_list',
      callId: ToolCallId('list'),
      arguments: {},
      agent: caller,
      signal: new AbortController().signal,
    })
    expect(listed.isError).not.toBe(true)
    expect(listed.value).toEqual({
      peers: [{ session_id: 'loader-target', title: 'Loader target', live: true, workspace: '/work' }],
      truncated: false,
    })

    const followup = vi.spyOn(target, 'followup')
    const sent = await executeToolFixture(context, {
      name: 'intercom_send',
      callId: ToolCallId('send'),
      arguments: { session_id: 'loader-target', text: 'hello from the loader' },
      agent: caller,
      signal: new AbortController().signal,
    })
    expect(sent.isError).not.toBe(true)
    expect(sent.value).toMatchObject({ target_session_id: 'loader-target', target_title: 'Loader target' })
    expect(followup.mock.calls.length).toBe(1)
    expect(followup.mock.calls[0]?.[0].content).toEqual([{
      type: 'text',
      text: '[Intercom message from session "Loader caller" (loader-caller), not the user]\nhello from the loader',
    }])
  })
})
