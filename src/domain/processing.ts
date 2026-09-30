import type { ActionEnvelope } from "./actions.js";

export type ProcessingOutcome = "handled" | "handoff" | "ignored" | "rollout_skipped";
export type HandlerProcessingOutcome = Exclude<ProcessingOutcome, "rollout_skipped">;

export interface ProcessingDisposition {
  outcome: ProcessingOutcome;
  handoffReason?: string;
}

export interface EventHandlingResult {
  actions: ActionEnvelope[];
  outcome: HandlerProcessingOutcome;
  handoffReason?: string;
}

const HANDOFF_REASON_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export function normalizeHandoffReason(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return HANDOFF_REASON_PATTERN.test(normalized) ? normalized : "unspecified";
}
