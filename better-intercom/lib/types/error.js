/** Stable intercom failure type. @module @deepseek-ai/dsh-experimental-session-intercom/error */
/** Failure produced by configuration validation, authorization, or delivery. */
export class IntercomError extends Error {
    /** Stable machine-readable discriminator. */
    code;
    /**
     * Construct one stable intercom failure.
     * @param code - public discriminator callers may switch on.
     * @param message - actionable diagnostic with no conversation content.
     * @param options - optional contained cause.
     */
    constructor(code, message, options) {
        super(message, options);
        this.name = 'IntercomError';
        this.code = code;
    }
}
//# sourceMappingURL=error.js.map