/** Cross-session explicit messaging without transcript reads. @module @deepseek-ai/dsh-experimental-session-intercom */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type Config } from './config.ts';
import type { IntercomListing, RelayIntercomRequest, SendIntercomRequest, SendIntercomResult } from './types.ts';
export { Config } from './config.ts';
export type { Config as IntercomConfig } from './config.ts';
export { IntercomError } from './error.ts';
export type * from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Explicit peer messaging across the Sessions of one DSH host. */
        intercom: SessionIntercom;
    }
}
/** Explicit peer messaging over Session inboxes; it never reads another Session's log. */
export declare class SessionIntercom extends Service {
    static inject: string[];
    static Config: z<Config>;
    private readonly config;
    private externalResolver;
    /**
     * @param ctx - host context carrying agents, Sessions, query, projections, and tools.
     * @param config - deployment access rules and message bounds.
     */
    constructor(ctx: Context, config?: Config);
    protected [Service.init](): Promise<void>;
    /**
     * List other Sessions the caller may message. Results carry titles and availability only.
     * @param caller - exact live Agent whose identity and permissions bound the listing.
     * @param query - optional case-insensitive substring matched against title or session id.
     * @param signal - optional cancellation for the underlying session listing.
     * @returns visible peers, newest first, and whether the configured page was truncated.
     */
    list(caller: Agent, query?: string, signal?: AbortSignal): Promise<IntercomListing>;
    /**
     * Deliver one explicit message to another Session's inbox.
     * @param caller - exact live Agent whose identity and permissions bound the send.
     * @param request - target Session and message body.
     * @param signal - optional cancellation checked before and after target activation.
     * @returns the accepted message identity and target metadata.
     * @throws {IntercomError} when the target is missing, unauthorized, self, inactive, or oversized.
     */
    send(caller: Agent, request: SendIntercomRequest, signal?: AbortSignal): Promise<SendIntercomResult>;
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
    relay(caller: Agent, request: RelayIntercomRequest, signal?: AbortSignal): Promise<SendIntercomResult>;
    /**
     * Shared delivery path: both direct messages and relays pass every authorization and
     * bound check here, so a new envelope kind cannot accidentally skip them.
     * @param caller - sending Agent.
     * @param to - target Session id, which must not be the caller.
     * @param text - fully rendered message body.
     * @param signal - optional cancellation.
     * @returns the accepted message identity and target metadata.
     */
    private deliver;
    private authorized;
    private resolveTarget;
    private titleOf;
    private titleOfRecord;
}
export default SessionIntercom;
//# sourceMappingURL=service.d.ts.map