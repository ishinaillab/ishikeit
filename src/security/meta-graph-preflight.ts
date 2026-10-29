import { withMetaGraphProof } from "../channels/meta-graph-proof.js";

type ProbeState =
  | "not_configured"
  | "inspection_unavailable"
  | "invalid_token"
  | "wrong_app"
  | "proof_unavailable"
  | "proof_compatible";

export interface MetaGraphPreflightResult {
  checkedAt: string;
  graphProofFlagUnchanged: true;
  channels: {
    messenger: ProbeState;
    whatsapp: ProbeState;
  };
}

export interface MetaGraphPreflightReader {
  probe(): Promise<MetaGraphPreflightResult>;
}

interface GraphTokenPreflightOptions {
  appId: string;
  appSecret: string;
  graphVersion: string;
  messengerToken?: string | undefined;
  whatsappToken?: string | undefined;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

function record(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null && !Array.isArray(x)
    ? x as Record<string, unknown> : undefined;
}

/**
 * A user-triggered, read-only Graph canary. No Meta send, template,
 * subscription, token refresh or app-wide setting mutation is performed.
 * Tokens and their originating app IDs are never included in the output.
 */
export class MetaGraphTokenPreflight implements MetaGraphPreflightReader {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #version: string;
  readonly #messengerToken: string | undefined;
  readonly #whatsappToken: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;

  constructor(options: GraphTokenPreflightOptions) {
    if (!/^[0-9]{5,32}$/u.test(options.appId)
      || !/^v[0-9]+\.[0-9]+$/u.test(options.graphVersion)
      || options.appSecret.length === 0) {
      throw new Error("Invalid Meta Graph preflight app configuration");
    }
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#version = options.graphVersion;
    this.#messengerToken = options.messengerToken;
    this.#whatsappToken = options.whatsappToken;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeout = options.requestTimeoutMs ?? 8000;
  }

  async probe(): Promise<MetaGraphPreflightResult> {
    const [messenger, whatsapp] = await Promise.all([
      this.#inspect(this.#messengerToken, "messenger"),
      this.#inspect(this.#whatsappToken, "whatsapp")
    ]);
    return {
      checkedAt: new Date().toISOString(),
      graphProofFlagUnchanged: true,
      channels: { messenger, whatsapp }
    };
  }

  async #get(url: URL, bearer: string): Promise<Record<string, unknown> | undefined> {
    // Only static Graph host/version endpoints are built below. Never log URL,
    // access token, input_token, HMAC proof or provider response body.
    if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com"
      || url.port !== "" || url.username !== "" || url.password !== "") {
      return undefined;
    }
    try {
      const response = await this.#fetch(url.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${bearer}`, accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.#timeout)
      });
      if (!response.ok) return undefined;
      const size = Number(response.headers.get("content-length") ?? "0");
      if (!Number.isFinite(size) || size > 16384) return undefined;
      const raw = await response.text();
      if (raw.length > 16384) return undefined;
      return record(JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  async #inspect(token: string | undefined, channel: "messenger" | "whatsapp"): Promise<ProbeState> {
    if (token === undefined || token.length === 0) return "not_configured";

    // Official /debug_token reads the token's originating application. Use an
    // app access token, and restrict all requests to HTTPS graph.facebook.com.
    // input_token is required by Meta in this GET query, never log the URL.
    const debuggerUrl = new URL(`https://graph.facebook.com/${this.#version}/debug_token`);
    debuggerUrl.searchParams.set("input_token", token);
    const appAccessToken = `${this.#appId}|${this.#appSecret}`;
    const inspected = await this.#get(debuggerUrl, appAccessToken);
    if (inspected === undefined) return "inspection_unavailable";
    const data = record(inspected.data);
    if (data === undefined || data.is_valid !== true) return "invalid_token";
    if (String(data.app_id) !== this.#appId) return "wrong_app";

    if (channel === "messenger") {
      // Page tokens may not have permission to read /me?fields=id.
      // Use the Page ID reported by Meta's token debugger and its subscription
      // edge, which is authorized with the existing Page-management scopes.
      const pageId = typeof data.profile_id === "string" || typeof data.profile_id === "number"
        ? String(data.profile_id) : "";
      const pageType = typeof data.type === "string" ? data.type.toUpperCase() : undefined;
      if ((pageType !== undefined && pageType !== "PAGE")
        || !/^[0-9]{5,32}$/u.test(pageId)) return "proof_unavailable";
      const subscriptionsUrl = new URL(
        `https://graph.facebook.com/${this.#version}/${pageId}/subscribed_apps`
      );
      subscriptionsUrl.searchParams.set("limit", "100");
      const signed = withMetaGraphProof(subscriptionsUrl, token, this.#appSecret);
      const subscriptions = await this.#get(signed, token);
      return Array.isArray(subscriptions?.data)
        && subscriptions.data.some((item: unknown) => {
          const id = record(item)?.id;
          return (typeof id === "string" || typeof id === "number")
            && String(id) === this.#appId;
        })
        ? "proof_compatible" : "proof_unavailable";
    }

    // System User WhatsApp tokens support a signed /me identity request.
    const meUrl = new URL(`https://graph.facebook.com/${this.#version}/me`);
    meUrl.searchParams.set("fields", "id");
    const signed = withMetaGraphProof(meUrl, token, this.#appSecret);
    const me = await this.#get(signed, token);
    return typeof me?.id === "string" || typeof me?.id === "number"
      ? "proof_compatible" : "proof_unavailable";
  }
}
