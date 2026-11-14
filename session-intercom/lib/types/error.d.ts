/** Stable intercom failure type. @module @deepseek-ai/dsh-experimental-session-intercom/error */
import type { IntercomErrorCode } from './types.ts';
/** Failure produced by configuration validation, authorization, or delivery. */
export declare class IntercomError extends Error {
    /** Stable machine-readable discriminator. */
    readonly code: IntercomErrorCode;
    /**
     * Construct one stable intercom failure.
     * @param code - public discriminator callers may switch on.
     * @param message - actionable diagnostic with no conversation content.
     * @param options - optional contained cause.
     */
    constructor(code: IntercomErrorCode, message: string, options?: ErrorOptions);
}
//# sourceMappingURL=error.d.ts.map