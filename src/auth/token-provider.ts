export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class AccessTokenError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { retryable: boolean; cause?: unknown }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AccessTokenError";
    this.retryable = options.retryable;
  }
}

export class StaticAccessTokenProvider implements AccessTokenProvider {
  constructor(private readonly accessToken: string) {}

  getAccessToken(): Promise<string> {
    return Promise.resolve(this.accessToken);
  }
}
