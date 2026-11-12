import { describe, expect, it } from "vitest";
import { privateLoginCss, privateLoginHtml } from "../src/http/private-browser-ui.js";
import { mfaModalCss, mfaModalHtml } from "../src/http/private-browser-mfa-modal.js";

/** Regression checks for independently checked Qwery Nails design tokens.
 * WCAG 2.2 SC 1.4.3 requires >=4.5:1 for normal-sized text.
 */
function luminance(hex:string):number {
  const channels=(hex.match(/[a-f0-9]{2}/giu)??[])
    .map(part=>parseInt(part,16)/255)
    .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  if(channels.length!==3)throw new Error("Invalid contrast-test color");
  return channels[0]!*0.2126+channels[1]!*0.7152+channels[2]!*0.0722;
}
function contrast(foreground:string,background:string):number {
  const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);
  return (values[0]!+0.05)/(values[1]!+0.05);
}
describe("Ishikeit private UI follows Qwery Nails theme and contrast requirements",()=>{
  it("uses verified Qwery Nails fonts and light skin palette, not generic Elementor defaults",()=>{
    expect(privateLoginCss).toContain('--ishi-heading-font:"Lusitana",Georgia,serif');
    expect(privateLoginCss).toContain('--ishi-body-font:"Questrial","Segoe UI",sans-serif');
    expect(privateLoginCss).toContain("--ishi-cream:#FFF8F3");
    expect(privateLoginCss).toContain("--ishi-blush:#F8E0D2");
    expect(privateLoginCss).toContain("--ishi-pink:#FFABB4");
    expect(privateLoginCss).toContain("--ishi-pink-hover:#F18B96");
    expect(privateLoginHtml).toContain("fonts.googleapis.com/css2?family=Questrial");
  });
  it("maintains WCAG AA text contrast on light, hover and destructive action surfaces",()=>{
    for(const [foreground,background] of [
      ["#242530","#FFF8F3"],["#242530","#FFFFFF"],
      ["#242530","#FFABB4"],["#242530","#F18B96"],
      ["#5A565F","#FFF8F3"],["#5A565F","#FFFFFF"],
      ["#FFFFFF","#B42338"],["#FFFFFF","#86192A"]
    ] as const)expect(contrast(foreground,background),foreground+" / "+background).toBeGreaterThanOrEqual(4.5);
  });
  it("explicitly sets readable text and background for modal, links and button hover",()=>{
    expect(mfaModalCss).toMatch(/\.mfa-dialog \.mfa-menu-item:hover[^}]*background:var\(--ishi-blush\);color:var\(--ishi-ink\)/u);
    expect(mfaModalCss).toMatch(/\.mfa-dialog \.mfa-primary:hover[^}]*background:var\(--ishi-pink-hover\);color:var\(--ishi-ink\)/u);
    expect(mfaModalCss).toMatch(/\.mfa-dialog \.mfa-danger:hover[^}]*background:#86192A;color:#fff/u);
    expect(mfaModalCss).toContain("button:focus-visible");
    expect(privateLoginCss).toContain("outline:3px solid var(--ishi-ink)");
  });
  it("has one visible sign-in authenticator method and valid pending-restart markup",()=>{
    expect(mfaModalHtml).not.toContain('id="mfa-signin-toggle"');
    expect(mfaModalHtml).toContain('id="mfa-method-toggle"');
    expect(mfaModalHtml).toContain('<div id="mfa-modal-pending-note"');
    expect(mfaModalHtml).toContain('id="mfa-modal-restart"');
    expect(mfaModalHtml).toContain('id="mfa-modal-cancel-setup"');
    expect(mfaModalHtml).toContain('<dialog id="mfa-dialog"');
  });
});
