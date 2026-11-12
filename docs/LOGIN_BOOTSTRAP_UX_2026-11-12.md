# Ishikeit sign-in bootstrap: quiet branded transition (2026-11-12)

## Problem
The static first frame at `/app/login` unconditionally showed
**“Checking your session…”** until the initial authenticated-state check
completed. This exposed an unnecessary implementation detail on every visit
and could flicker during a fast navigation.

## Adopted UX and rationale
- Show only a **stable Ishikeit brand** on its existing warm-cream surface
  while the server validates the session. The login form and workspace remain
  hidden until the server returns the appropriate state; **never** reveal a
  fake email form before checking an existing session.
- Preserve the brand's position as progress appears; position deferred feedback
  outside the normal layout flow to avoid visible layout shift.
- Suppress visible activity indicators for the first **900 ms**. Only if the
  request is still pending, reveal a small indeterminate progress **line**.
- If opening is unusually slow (beyond **4 seconds**), show the user-facing
  **“Opening Ishikeit…”**, rather than a technical account/session diagnostic.
- Keep a screen-reader-only polite status for the initial wait. Respect
  `prefers-reduced-motion: reduce`: the delayed progress line stays static.
- On every completed initial outcome (public login, email code step,
  TOTP challenge, or authorized workspace), cancel the pending boot timers,
  hide the placeholder, and display only the resolved view. Do not change
  session-refresh logic or server-side authorization.
- If JavaScript fails or the backend never returns, the branded placeholder
  can still reveal honest delayed progress and a non-technical label. This
  is not a claim of successful sign-in.

## Research and distinctions
These are **documented design-system conventions**, not claims that every
large website has an identical sign-in implementation:

- Microsoft's Fluent Wait UX advises **no animation under one second**, a
  short indicator for longer waits, and clear feedback for genuinely prolonged
  work: https://fluent2.microsoft.design/wait-ux/
- Nielsen Norman Group advises avoiding skeletons or spinners for quick
  page loads under one second; a skeleton should match the actual destination
  rather than show a misleading placeholder:
  https://www.nngroup.com/articles/skeleton-screens/
- Apple's Human Interface Guidelines advise not displaying vague or
  internal progress descriptions and keeping indicators consistent:
  https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Google's web.dev layout-stability guidance: reserve space for
  asynchronous content or overlay it without shifting existing content:
  https://web.dev/articles/optimize-cls
- W3C WAI-ARIA and WCAG status guidance: provide appropriate assistive
  technology feedback for status changes, without forcibly moving focus:
  https://www.w3.org/TR/wai-aria/#status
  https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html

## Security and regression acceptance
- The BFF remains the sole authority for the session, MFA requirement,
  and workspace authorization. No token caching, extra dependencies,
  localStorage, extra endpoints, or code changes to TOTP or email-OTP logic.
- Automated shipped-script tests cover fast unauthenticated login, a
  deliberately delayed initial request, late progress/text reveal, correct
  transition to existing AAL2 workspace, and the MFA-required gate.
- Validate Node 24 lint, typecheck, focused browser UI/HTTP, full suite,
  production build, protected CI, exact Hostinger deployment commit, live
  health and anonymous workspace denial.
