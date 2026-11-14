/** Deployment limits and access rules for {@link SessionIntercom}. @module @deepseek-ai/dsh-experimental-session-intercom/config */
import z from '@deepseek-ai/schemastery';
import { SessionId } from '@deepseek-ai/dsh-session';
/** Default maximum UTF-8 bytes in one message body. */
export declare const DEFAULT_MAX_MESSAGE_BYTES = 65536;
/** Default maximum peers returned by one listing. */
export declare const DEFAULT_MAX_PEERS = 100;
/** Largest peer page a deployment may configure. */
export declare const MAX_PEERS_LIMIT = 10000;
/** Deployment-owned bounds and access rules. */
export interface Config {
    /** Maximum UTF-8 bytes in one message body, excluding the sender frame. Defaults to 65536. */
    maxMessageBytes?: number;
    /** Maximum peers returned by one listing. Defaults to 100. */
    maxPeers?: number;
    /** Allow only targets whose recorded working directory equals the caller's. Defaults to false. */
    sameWorkspaceOnly?: boolean;
    /** When non-empty, the complete set of session ids that may receive messages. Defaults to empty. */
    allowedSessionIds?: string[];
    /** Session ids that may never receive messages. Denial wins over {@link allowedSessionIds}. Defaults to empty. */
    deniedSessionIds?: string[];
}
/** Validated configuration used by every intercom operation. */
export interface ResolvedConfig {
    readonly maxMessageBytes: number;
    readonly maxPeers: number;
    readonly sameWorkspaceOnly: boolean;
    readonly allowedSessionIds: ReadonlySet<SessionId>;
    readonly deniedSessionIds: ReadonlySet<SessionId>;
}
/** Schemastery schema used by Loader validation and generated configuration docs. */
export declare const Config: z<Config>;
/**
 * Validate and normalize deployment configuration.
 * @param config - Loader-provided configuration; omitted fields use documented defaults.
 * @returns the complete normalized configuration.
 * @throws when a numeric bound or explicit session-id list is invalid.
 */
export declare function resolveConfig(config?: Config): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map