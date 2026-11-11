import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

/**
 * Source-controlled Supabase email template contract. Supabase Auth's
 * html/template automatically URL-escapes .Email inside an href attribute.
 * See https://pkg.go.dev/html/template and Supabase Auth Email Templates.
 * The actual OTP remains outside the URL and must still be entered manually.
 */
describe("email OTP sign-in link is code-entry-only",()=>{
  it("links the emailed address to the code screen without embedding an auth bearer",async()=>{
    const html=await readFile("email/supabase/magic-link-otp.html","utf8");
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain(
      'href="https://apps.ishinaillab.com/app/login#verify-email={{ .Email }}"');
    expect(html).not.toContain("{{ .TokenHash }}");
    expect(html).not.toContain("{{ .ConfirmationURL }}");
    expect(html).not.toContain("https://apps.ishinaillab.com/app/login?email=");
    expect(html).not.toContain("{{ .Email | urlquery }}");
    expect(html).not.toMatch(/href="[^"]*(?:token_hash|access_token|refresh_token)=/iu);
    expect((html.match(/\{\{\s*\.Token\s*\}\}/gu)||[]).length).toBe(1);
  });
});
