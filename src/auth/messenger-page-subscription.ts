/**
 * Meta's app-level Page webhook fields and the individual Page's
 * subscribed_apps fields are independent. Reconcile only after the bearer
 * token resolves to a Page previously observed in signed customer ingress.
 */
export const MESSENGER_PAGE_WEBHOOK_FIELDS = [
  "messages",
  "message_deliveries",
  "message_reads",
  "messaging_postbacks",
  "messaging_handovers"
] as const;

export class MessengerPageSubscriptionError extends Error {
  constructor(readonly stage: string, readonly status?: number) {
    super(`Messenger Page webhook ${stage} failed${status === undefined ? "" : ` (HTTP ${status})`}`);
    this.name = "MessengerPageSubscriptionError";
  }
}

interface Options {
  appId: string;
  graphApiVersion: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface JsonRecord {
  [key: string]: unknown;
}

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {};
}

export class MessengerPageSubscriptionClient {
  readonly #appId: string;
  readonly #graphApiVersion: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: Options) {
    if (!/^\d{5,32}$/u.test(options.appId) || !/^v\d+\.\d+$/u.test(options.graphApiVersion)) {
      throw new Error("Invalid Messenger Page subscription app configuration");
    }
    this.#appId = options.appId;
    this.#graphApiVersion = options.graphApiVersion;
    this.#timeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async reconcile(
    accessToken: string,
    isKnownSignedInboundPage: (pageId: string) => Promise<boolean>
  ): Promise<{ changed: boolean }> {
    if (accessToken.trim().length === 0) {
      throw new MessengerPageSubscriptionError("access_token_missing");
    }

    // Resolve identity through the credential itself. Never infer the Page
    // from an unrelated OAuth tester or a caller-supplied page identifier.
    const identity = await this.#request(
      new URL(`https://graph.facebook.com/${this.#graphApiVersion}/me?fields=id`),
      accessToken, "identity_resolution"
    );
    const pageId = identity.id;
    if (typeof pageId !== "string" || !/^\d{5,32}$/u.test(pageId)) {
      throw new MessengerPageSubscriptionError("invalid_page_identity");
    }
    if (!await isKnownSignedInboundPage(pageId)) {
      throw new MessengerPageSubscriptionError("page_identity_mismatch");
    }

    const current = await this.#readFields(pageId, accessToken);
    const missing = MESSENGER_PAGE_WEBHOOK_FIELDS.filter((field) => !current.includes(field));
    if (missing.length === 0) return { changed: false };

    // Preserve any previously configured fields. A subsequent startup must
    // never silently remove a Page's unrelated existing subscriptions.
    const desired = [...new Set([...current, ...MESSENGER_PAGE_WEBHOOK_FIELDS])];
    const body = new URLSearchParams({ subscribed_fields: desired.join(",") });
    const result = await this.#request(this.#url(pageId, false), accessToken,
      "field_subscription", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
    if (result.success !== true && result.success !== "true") {
      throw new MessengerPageSubscriptionError("subscription_unconfirmed");
    }

    const confirmed = await this.#readFields(pageId, accessToken);
    if (!MESSENGER_PAGE_WEBHOOK_FIELDS.every((field) => confirmed.includes(field))) {
      throw new MessengerPageSubscriptionError("readback_mismatch");
    }
    return { changed: true };
  }

  #url(pageId: string, forRead = true): URL {
    const url = new URL(`https://graph.facebook.com/${this.#graphApiVersion}/${pageId}/subscribed_apps`);
    if (forRead) {
      url.searchParams.set("fields", "id,subscribed_fields");
      url.searchParams.set("limit", "100");
    }
    return url;
  }

  async #readFields(pageId: string, token: string): Promise<string[]> {
    const json = await this.#request(this.#url(pageId), token, "subscription_read");
    const apps = Array.isArray(json.data) ? json.data.map(object) : [];
    const matchingApps = apps.filter((entry) => entry.id === this.#appId);
    // Never install an app on a Page when its existing, verified Page
    // subscription cannot be identified. This is strictly a field upgrade.
    if (matchingApps.length !== 1) {
      throw new MessengerPageSubscriptionError("app_not_subscribed_to_page");
    }
    const raw = matchingApps[0]?.subscribed_fields;
    return Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === "string")
      : [];
  }

  async #request(
    url: URL, accessToken: string, stage: string, init: RequestInit = {}
  ): Promise<JsonRecord> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${accessToken}`);
      response = await this.#fetch(url.toString(), {
        ...init,
        redirect: "error",
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch {
      // Never include URLs, Graph error bodies, token values or page IDs in
      // operational log messages.
      throw new MessengerPageSubscriptionError(stage + "_unavailable");
    }
    if (!response.ok) throw new MessengerPageSubscriptionError(stage, response.status);
    try {
      return object(await response.json());
    } catch {
      throw new MessengerPageSubscriptionError(stage + "_invalid_json");
    }
  }
}
