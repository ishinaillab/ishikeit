import { DispatchFailure } from "../dispatch/failure.js";

export interface TelegramBusinessAccount {
  connectionId: string;
  ownerId: string;
}

/**
 * Verified, account-bound Telegram Business readback, even if a right was
 * removed. Only a studio-owner-matched response can generate this evidence.
 */
export interface TelegramBusinessObservation extends TelegramBusinessAccount {
  enabled: boolean;
  rights: Readonly<Record<string, boolean>>;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/**
 * Telegram Bot API business connections belong to a specific real user.
 * Only authorize the explicitly configured studio username, not any other
 * business that happens to connect this bot. Revalidate per message rather
 * than retaining stale connection rights in memory.
 *
 * Never log token, connection ID, chat, username, or raw provider response.
 */
export class TelegramBusinessVerifier {
  readonly #botToken: string;
  readonly #expectedUsername: string;
  readonly #expectedOwnerId: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    botToken: string;
    expectedUsername: string;
    expectedOwnerId?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!/^[A-Za-z0-9_]{5,32}$/u.test(options.expectedUsername.replace(/^@/u, ""))) {
      throw new Error("Invalid Telegram Business username configuration");
    }
    if (options.expectedOwnerId !== undefined
      && (!/^[1-9][0-9]{0,15}$/u.test(options.expectedOwnerId)
        || !Number.isSafeInteger(Number(options.expectedOwnerId)))) {
      throw new Error("Invalid immutable Telegram owner ID configuration");
    }
    this.#expectedOwnerId = options.expectedOwnerId;
    this.#botToken = options.botToken;
    this.#expectedUsername = options.expectedUsername.replace(/^@/u, "").toLowerCase();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async verify(connectionId: string): Promise<TelegramBusinessAccount> {
    const observation = await this.inspect(connectionId);
    if (!observation.enabled || observation.rights.can_reply !== true) {
      throw new DispatchFailure("Telegram Business connection not authorized for the studio", {
        retryable: false
      });
    }
    return { connectionId: observation.connectionId, ownerId: observation.ownerId };
  }

  async inspect(connectionId: string): Promise<TelegramBusinessObservation> {
    if (connectionId.length === 0 || connectionId.length > 256
      || hasControlCharacter(connectionId)) {
      throw new DispatchFailure("Telegram business connection ID invalid", { retryable: false });
    }
    let response: Response;
    try {
      response = await this.#fetch(
        "https://api.telegram.org/bot" + this.#botToken + "/getBusinessConnection",
        {
          method: "POST", redirect: "error", cache: "no-store",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ business_connection_id: connectionId }),
          signal: AbortSignal.timeout(this.#timeoutMs)
        }
      );
    } catch {
      throw new DispatchFailure("Telegram Business connection inspection unavailable", {
        retryable: true
      });
    }
    if (!response.ok) {
      throw new DispatchFailure("Telegram Business connection not available", {
        retryable: response.status === 429 || response.status >= 500,
        status: response.status
      });
    }
    // Telegram returns a small BusinessConnection object. Refuse oversized
    // bodies without relying on the Content-Length header.
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new DispatchFailure("Telegram Business connection response missing", { retryable: true });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        if (item.value === undefined) continue;
        total += item.value.byteLength;
        if (total > 16384) {
          await reader.cancel().catch(() => undefined);
          throw new DispatchFailure("Telegram Business connection response oversized", { retryable: true });
        }
        chunks.push(item.value);
      }
    } catch (error) {
      if (error instanceof DispatchFailure) throw error;
      throw new DispatchFailure("Telegram Business connection response unavailable", { retryable: true });
    } finally {
      reader.releaseLock();
    }
    let body: Record<string, unknown> | undefined;
    try {
      body = record(JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown);
    } catch {
      throw new DispatchFailure("Telegram Business connection response invalid", { retryable: true });
    }
    const result = record(body?.result);
    const owner = record(result?.user);
    const rights = record(result?.rights);
    const ownerId = owner?.id;
    const ownerUsername = owner?.username;
    if (body?.ok !== true || result?.id !== connectionId
      || typeof result?.is_enabled !== "boolean"
      || typeof ownerId !== "number" || !Number.isSafeInteger(ownerId)
      || (this.#expectedOwnerId === undefined
        ? typeof ownerUsername !== "string"
          || ownerUsername.toLowerCase() !== this.#expectedUsername
        : String(ownerId) !== this.#expectedOwnerId)) {
      throw new DispatchFailure("Telegram Business connection not authorized for the studio", {
        retryable: false
      });
    }
    // Do not guess a right from plan, username or absent property.
    // Preserve new provider rights as observed evidence without ever treating
    // them as callable Ishikeit operations until an official adapter exists.
    const observedRights: Record<string, boolean> = {};
    for (const [name, value] of Object.entries(rights ?? {})) {
      if (/^can_[a-z0-9_]{1,80}$/u.test(name) && typeof value === "boolean") {
        observedRights[name] = value;
      }
    }
    // Omitting can_reply is a documented absence of this optional True field.
    observedRights.can_reply = rights?.can_reply === true;
    return {
      connectionId, ownerId: String(ownerId), enabled: result.is_enabled,
      rights: observedRights
    };
  }
}
