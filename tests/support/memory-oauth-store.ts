import type {
  OAuthAuthorizationState,
  OAuthCredential,
  OAuthCredentialStore
} from "../../src/auth/oauth-store.js";

export class MemoryOAuthStore implements OAuthCredentialStore {
  readonly credentials = new Map<string, OAuthCredential>();
  readonly revocations = new Set<string>();
  readonly states = new Map<string, {
    provider: string;
    redirectUri: string;
    expiresAt: Date;
    consumed: boolean;
  }>();
  readonly #refreshLockTails = new Map<string, Promise<void>>();

  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }

  get(provider: string, accountId: string): Promise<OAuthCredential | undefined> {
    return Promise.resolve(this.credentials.get(provider + ":" + accountId));
  }

  latest(provider: string): Promise<OAuthCredential | undefined> {
    const values = [...this.credentials.values()].filter((item) => item.provider === provider);
    return Promise.resolve(values.at(-1));
  }

  put(credential: Omit<OAuthCredential, "tokenVersion">): Promise<void> {
    const key = credential.provider + ":" + credential.accountId;
    const previous = this.credentials.get(key);
    this.credentials.set(key, {
      ...credential,
      tokenVersion: (previous?.tokenVersion ?? 0) + 1
    });
    this.revocations.delete(key);
    return Promise.resolve();
  }

  revoke(provider: string, accountId: string, reason: string): Promise<void> {
    void reason;
    const key = provider + ":" + accountId;
    this.revocations.add(key);
    this.credentials.delete(key);
    return Promise.resolve();
  }

  isRevoked(provider: string, accountId: string): Promise<boolean> {
    return Promise.resolve(this.revocations.has(provider + ":" + accountId));
  }

  async withRefreshLock<T>(
    provider: string,
    accountId: string,
    work: () => Promise<T>
  ): Promise<T> {
    const key = provider + ":" + accountId;
    const previous = this.#refreshLockTails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#refreshLockTails.set(key, tail);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#refreshLockTails.get(key) === tail) {
        this.#refreshLockTails.delete(key);
      }
    }
  }

  createAuthorizationState(
    provider: string,
    stateHash: string,
    redirectUri: string,
    expiresAt: Date
  ): Promise<void> {
    this.states.set(stateHash, {
      provider,
      redirectUri,
      expiresAt,
      consumed: false
    });
    return Promise.resolve();
  }

  consumeAuthorizationState(
    provider: string,
    stateHash: string
  ): Promise<OAuthAuthorizationState | undefined> {
    const state = this.states.get(stateHash);
    if (
      state === undefined
      || state.provider !== provider
      || state.consumed
      || state.expiresAt.getTime() <= Date.now()
    ) {
      return Promise.resolve(undefined);
    }
    state.consumed = true;
    return Promise.resolve({ provider, redirectUri: state.redirectUri });
  }
}
