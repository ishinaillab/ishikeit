import type { ActionEnvelope, ActionResult } from "../domain/actions.js";
import { DispatchFailure } from "./failure.js";

export interface ActionAdapter {
  readonly provider: string;
  readonly capability: string;
  readonly operation: string;
  execute(action: ActionEnvelope): Promise<ActionResult>;
}

function key(provider: string, capability: string, operation: string): string {
  return [provider, capability, operation].join("/");
}

export class ActionDispatcher {
  readonly #adapters = new Map<string, ActionAdapter>();

  register(adapter: ActionAdapter): void {
    const adapterKey = key(adapter.provider, adapter.capability, adapter.operation);
    if (this.#adapters.has(adapterKey)) {
      throw new Error("duplicate action adapter: " + adapterKey);
    }
    this.#adapters.set(adapterKey, adapter);
  }

  async dispatch(action: ActionEnvelope): Promise<ActionResult> {
    const adapter = this.#adapters.get(key(action.provider, action.capability, action.operation));
    if (adapter === undefined) {
      throw new DispatchFailure(
        `No adapter registered for ${action.provider}/${action.capability}/${action.operation}`,
        { retryable: false }
      );
    }
    return adapter.execute(action);
  }
}
