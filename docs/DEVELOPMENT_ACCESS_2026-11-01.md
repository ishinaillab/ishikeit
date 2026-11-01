# Ishikeit development access and release workflow (2026-11-01)

This file documents verified access, not a grant of new permissions or an override of platform safety checks.

## Verified connections
- ChatGPT app permissions: Ishi Local Agent, GitHub and Hostinger Official MCP are already **Allow all actions** (per plugin permission readback).
- GitHub connector: administrator and push privileges to `ishinaillab/ishikeit`. Creating the non-production `test/instagram-renewal-20261101` branch through the native GitHub app succeeded.
- Ishi Local Agent: Windows `win32`; `D:\projects\openai` workspace authorized; shell/process policies `full`; file, Git, shell, browser and desktop tools present. Sensitive paths (including source filename patterns matching `*token*`) remain guarded by the local agent and should not be weakened to diagnose generic blocks.
- Docker: relocated data under `D:\projects\docker`. Local disposable Node 24/PostgreSQL 17 verification succeeded in the isolated Ishikeit worktree.
- Hostinger Official MCP: authenticated to the correct account for `apps.ishinaillab.com`; production Node 24/Fastify deployment and runtime/build log reads available. Git auto-deploy currently tracks **`ishinaillab/ishikeit:main` only**.
- Supabase: official connector for `vhmrliqemkfxblzsoyaz`; metadata reads and migration operation present.
- Remote Desktop Commander: Windows device reported offline during the audit.
- TRIGGERcmd: existing account connected, but its six registered commands do not include an arbitrary production shell or Git push command.

## Release safety
1. Never edit the canonical checkout while it has unrelated modifications; make a fresh isolated worktree from remote production `main`.
2. Run isolated tests before PR. Prefer GitHub's native branch/content/PR operations when local Git push is blocked rather than silently assuming source was published.
3. Keep changes on a feature branch, open a PR, validate CI, review changes and deployment blast radius, then use the authorized merge/release flow.
4. Never merge a one-time Instagram refresh harness without verified private claim-table guards and a removal plan.
5. Never expose Meta tokens, database URLs or credential encryption keys in ChatGPT, repository files, logs, webhook responses or public test endpoints.
6. Do not interpret "Allow all actions" as bypassing OpenAI safety checks, provider OAuth consent, workspace policies or missing tool capabilities.
7. For direct Hostinger Node.js production commands, the connected hosted Hostinger API does not expose a general-purpose private terminal. A separately authorized SSH or other private server execution path must be established, not fabricated.
8. Preserve manual BitLocker unlocking. Never automatically unlock the drive.

## Project-specific holds
- Phase 2 begins only when the Instagram one-time live proof and cleanup are actually verified or when the owner changes the hold.
- Phase 3 dashboard remains on `apps.ishinaillab.com`.
- Phase 4 WordPress plugin must be named exactly `LatePoint Addon - Ishikeit Automation`.
- TikTok Messaging remains gated on its separate provider approval.
- Do not alter premiums or unrelated WordPress security holds.

## Source notes
Official OpenAI app-permission guidance: https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt
Official troubleshooting for explicit safety blocks: https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt
