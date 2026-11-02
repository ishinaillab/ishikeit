import { z } from "zod";

const tokenResponse = z.object({
  access_token: z.string().min(40).max(8192),
  refresh_token: z.string().min(20).max(4096),
  token_type: z.literal("bearer"),
  expires_in: z.number().int().min(60).max(86400)
}).passthrough();

export type SupabaseIssuedTokens = z.infer<typeof tokenResponse>;
export interface EmailOtpConfig {
  projectUrl: string;
  publishableKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Official Supabase Auth REST API. Server-to-server only.
 * No signup, magic-link browser redirects, passwords or service-role key.
 * The email template must explicitly contain {{ .Token }} to send OTP.
 */
export class SupabaseEmailOtpClient {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  constructor(options: EmailOtpConfig) {
    const parsed = new URL(options.projectUrl);
    if (parsed.protocol !== "https:"
      || !/^[a-z0-9]{20}\.supabase\.co$/u.test(parsed.hostname)
      || parsed.pathname !== "/" || parsed.search || parsed.hash
      || parsed.username || parsed.password || parsed.port) {
      throw new Error("Supabase OTP requires an exact project origin");
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,200}$/u.test(options.publishableKey)) {
      throw new Error("Supabase OTP requires a project publishable key");
    }
    this.#base = parsed.origin + "/auth/v1";
    this.#key = options.publishableKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeout = z.number().int().min(1000).max(15000).parse(options.timeoutMs ?? 7000);
  }

  async #post(path: string, body: Record<string, unknown>, bearer?: string): Promise<Response> {
    try {
      return await this.#fetch(this.#base + path,{
        method:"POST",redirect:"error",cache:"no-store",
        headers:{
          "content-type":"application/json",accept:"application/json",apikey:this.#key,
          ...(bearer === undefined ? {} : { authorization:"Bearer "+bearer })
        },
        body:JSON.stringify(body),signal:AbortSignal.timeout(this.#timeout)
      });
    } catch {
      throw new Error("Supabase authentication service unavailable");
    }
  }

  async #tokens(response: Response): Promise<SupabaseIssuedTokens> {
    if (!response.ok) throw new Error("Supabase authentication rejected");
    let payload: unknown;
    try {
      const len = Number(response.headers.get("content-length") ?? "0");
      if (len > 16384) throw Error("large");
      const text=await response.text();
      if (text.length > 16384) throw Error("large");
      payload=JSON.parse(text) as unknown;
    } catch {
      throw new Error("Supabase authentication response invalid");
    }
    try { return tokenResponse.parse(payload); }
    catch { throw new Error("Supabase authentication response invalid"); }
  }

  async sendOtp(email: string): Promise<void> {
    const response = await this.#post("/otp",{ email, create_user:false });
    if (!response.ok) throw new Error("Supabase OTP request unavailable");
  }
  async verifyOtp(email: string, token: string): Promise<SupabaseIssuedTokens> {
    return this.#tokens(await this.#post("/verify",{email,token,type:"email"}));
  }
  async refresh(refreshToken: string): Promise<SupabaseIssuedTokens> {
    return this.#tokens(await this.#post("/token?grant_type=refresh_token",
      {refresh_token:refreshToken}));
  }
  async revoke(accessToken: string): Promise<void> {
    // Local BFF revocation is authoritative even if the IdP is unreachable.
    await this.#post("/logout?scope=local",{},accessToken);
  }
}
