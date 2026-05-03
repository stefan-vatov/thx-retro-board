import { Effect } from "effect";
import type { KeyboardEvent } from "react";

export function submitFormOnModEnter<T extends HTMLElement>(event: KeyboardEvent<T>) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.closest("form")?.requestSubmit();
}

export function submitFormOnModEnterEffect<T extends HTMLElement>(event: KeyboardEvent<T>): Effect.Effect<void> {
  return Effect.sync(() => submitFormOnModEnter(event));
}
