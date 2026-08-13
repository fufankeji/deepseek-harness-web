import type { HarnessEvent } from "../contracts.js";

type Listener = (event: HarnessEvent) => void;

export class EventBus {
  #listeners = new Set<Listener>();

  publish(event: HarnessEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}
