import { z } from "zod";
import type {
  ConnectionIntentCompletion, ConnectionIntentStart,
  PostgresWorkspaceConnectionIntents
} from "../persistence/workspace-connection-intents.js";
import type { SupabaseAuthPrincipalVerifier } from "./supabase-workspace-principal.js";

/**
 * Only the trusted verified-session boundary may supply actor and
 * auth_session_id to an account-connect intent. Request bodies are never
 * allowed to dictate a workspace role, principal, account identity or rights.
 *
 * This is an internal application service, not an HTTP endpoint. A future
 * BFF must source accessToken from its secured server-side session, nonce
 * from a host-only HttpOnly cookie, and provider/config from allowlisted
 * server registration; never forward user-constructed headers as trust.
 */
const uuid = z.string().uuid();
const provider = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const requestSchema = z.object({
  accessToken: z.string().min(50).max(8192),
  workspaceId: uuid,
  provider,
  providerApplicationKey: provider,
  redirectUri: z.string().url()
}).strict();
const completionSchema = requestSchema.extend({
  state: z.string().min(20).max(256),
  browserNonce: z.string().min(20).max(256)
}).strict();

export class AuthenticatedWorkspaceConnectionIntents {
  constructor(
    private readonly identity: Pick<SupabaseAuthPrincipalVerifier,"verifyAccessToken">,
    private readonly intents: Pick<PostgresWorkspaceConnectionIntents,"begin"|"consume">
  ) {}

  async begin(input: z.infer<typeof requestSchema>): Promise<ConnectionIntentStart> {
    const request = requestSchema.parse(input);
    // Fresh readback of the current user and actual auth.sessions row.
    // The intent store then ALSO verifies live owner/admin membership.
    const verified = await this.identity.verifyAccessToken(request.accessToken);
    return this.intents.begin({
      workspaceId:request.workspaceId,
      actor:verified.principal,
      sessionId:verified.sessionId,
      provider:request.provider,
      providerApplicationKey:request.providerApplicationKey,
      redirectUri:request.redirectUri
    });
  }

  async consume(input: z.infer<typeof completionSchema>): Promise<ConnectionIntentCompletion | undefined> {
    const request = completionSchema.parse(input);
    const verified = await this.identity.verifyAccessToken(request.accessToken);
    return this.intents.consume({
      workspaceId:request.workspaceId,
      actor:verified.principal,
      sessionId:verified.sessionId,
      provider:request.provider,
      providerApplicationKey:request.providerApplicationKey,
      redirectUri:request.redirectUri,
      state:request.state,
      browserNonce:request.browserNonce
    });
  }
}
