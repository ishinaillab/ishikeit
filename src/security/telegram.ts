import { timingSafeEqual } from "node:crypto";

const botTokenPattern = /^([0-9]+):[A-Za-z0-9_-]+$/;

export function telegramBotIdFromToken(token: string): string {
  const match = botTokenPattern.exec(token);
  if (match === null) throw new Error("Invalid Telegram bot token format");
  return match[1]!;
}

export function verifyTelegramWebhookSecret(
  suppliedSecret: string | undefined,
  expectedSecret: string
): boolean {
  if (suppliedSecret === undefined) return false;
  const supplied = Buffer.from(suppliedSecret);
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
