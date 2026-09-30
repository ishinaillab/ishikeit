export class DispatchFailure extends Error {
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      ambiguous?: boolean;
      status?: number;
      providerCode?: string;
      retryAfterMs?: number;
      cause?: unknown;
    }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DispatchFailure";
    this.retryable = options.retryable;
    this.ambiguous = options.ambiguous ?? false;
    if (options.status !== undefined) this.status = options.status;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}
