/** Deployment limits and access rules for {@link SessionIntercom}. @module @deepseek-ai/dsh-experimental-session-intercom/config */

import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { IntercomError } from './error.ts'

/** Default maximum UTF-8 bytes in one message body. */
export const DEFAULT_MAX_MESSAGE_BYTES = 65_536

/** Default maximum peers returned by one listing. */
export const DEFAULT_MAX_PEERS = 100

/** Largest peer page a deployment may configure. */
export const MAX_PEERS_LIMIT = 10_000

/** Deployment-owned bounds and access rules. */
export interface Config {
  /** Maximum UTF-8 bytes in one message body, excluding the sender frame. Defaults to 65536. */
  maxMessageBytes?: number
  /** Maximum peers returned by one listing. Defaults to 100. */
  maxPeers?: number
  /** Allow only targets whose recorded working directory equals the caller's. Defaults to false. */
  sameWorkspaceOnly?: boolean
  /** When non-empty, the complete set of session ids that may receive messages. Defaults to empty. */
  allowedSessionIds?: string[]
  /** Session ids that may never receive messages. Denial wins over {@link allowedSessionIds}. Defaults to empty. */
  deniedSessionIds?: string[]
}

/** Validated configuration used by every intercom operation. */
export interface ResolvedConfig {
  readonly maxMessageBytes: number
  readonly maxPeers: number
  readonly sameWorkspaceOnly: boolean
  readonly allowedSessionIds: ReadonlySet<SessionId>
  readonly deniedSessionIds: ReadonlySet<SessionId>
}

/** Schemastery schema used by Loader validation and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
  maxPeers: z.number().step(1).min(1).default(DEFAULT_MAX_PEERS),
  sameWorkspaceOnly: z.boolean().default(false),
  allowedSessionIds: z.array(z.string()).default([]),
  deniedSessionIds: z.array(z.string()).default([]),
})

function sessionIdSet(name: string, values: readonly string[]): ReadonlySet<SessionId> {
  const result = new Set<SessionId>()
  for (const value of values) {
    if (value.trim() !== value || value.length === 0) {
      throw new IntercomError('INTERCOM_INVALID_CONFIG', `session-intercom: ${name} entries must be non-empty without surrounding whitespace`)
    }
    const id = SessionId(value)
    if (result.has(id)) {
      throw new IntercomError('INTERCOM_INVALID_CONFIG', `session-intercom: ${name} contains duplicate session id "${value}"`)
    }
    result.add(id)
  }
  return result
}

/**
 * Validate and normalize deployment configuration.
 * @param config - Loader-provided configuration; omitted fields use documented defaults.
 * @returns the complete normalized configuration.
 * @throws when a numeric bound or explicit session-id list is invalid.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxMessageBytes = config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
    throw new IntercomError('INTERCOM_INVALID_CONFIG', 'session-intercom: maxMessageBytes must be a positive safe integer')
  }
  const maxPeers = config.maxPeers ?? DEFAULT_MAX_PEERS
  if (!Number.isSafeInteger(maxPeers) || maxPeers < 1 || maxPeers > MAX_PEERS_LIMIT) {
    throw new IntercomError(
      'INTERCOM_INVALID_CONFIG',
      `session-intercom: maxPeers must be a positive safe integer no greater than ${MAX_PEERS_LIMIT}`,
    )
  }
  return {
    maxMessageBytes,
    maxPeers,
    sameWorkspaceOnly: config.sameWorkspaceOnly ?? false,
    allowedSessionIds: sessionIdSet('allowedSessionIds', config.allowedSessionIds ?? []),
    deniedSessionIds: sessionIdSet('deniedSessionIds', config.deniedSessionIds ?? []),
  }
}
