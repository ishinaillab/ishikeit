/**
 * Provider-neutral delivery of human-facing links from AI plain-text replies.
 * WhatsApp, Messenger and Instagram text APIs accept text bodies, not an
 * abstract Markdown document. Telegram sendMessage has no parse_mode here.
 * Convert Markdown inline links to visible https URLs, leaving unrelated
 * formatting, raw links and media untouched. Never change URL bytes.
 */
export function explicitLinks(text: string): string {
  return text.replace(
    /\[([^\]\r\n]{1,120})\]\((https?:\/\/[^\s<>()[\]]+)\)/gu,
    (_match, label: string, url: string) => `${label}: ${url}`
  );
}
