import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  TURNSTILE_SCRIPT_ID,
  TURNSTILE_SCRIPT_SRC,
  loadTurnstileScriptEffect,
  type TurnstileScriptElement,
} from "./turnstile-effect";

function createScriptElement(): TurnstileScriptElement & { fire: (event: "load" | "error") => void } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    id: "",
    src: "",
    async: false,
    defer: false,
    addEventListener: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    fire: (event) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

describe("loadTurnstileScriptEffect", () => {
  it("does nothing when Turnstile is already available", async () => {
    let appended = false;

    await expect(Effect.runPromise(loadTurnstileScriptEffect({
      hasTurnstile: () => true,
      findExistingScript: () => null,
      createScript: createScriptElement,
      appendScript: () => {
        appended = true;
      },
    }))).resolves.toBeUndefined();

    expect(appended).toBe(false);
  });

  it("creates and appends the explicit Turnstile script when missing", async () => {
    let created: ReturnType<typeof createScriptElement> | null = null;
    const promise = Effect.runPromise(loadTurnstileScriptEffect({
      hasTurnstile: () => false,
      findExistingScript: () => null,
      createScript: () => {
        created = createScriptElement();
        return created;
      },
      appendScript: () => undefined,
    }));

    expect(created).toMatchObject({
      id: TURNSTILE_SCRIPT_ID,
      src: TURNSTILE_SCRIPT_SRC,
      async: true,
      defer: true,
    });
    created?.fire("load");
    await expect(promise).resolves.toBeUndefined();
  });

  it("fails when an existing script emits an error", async () => {
    const existing = createScriptElement();
    const promise = Effect.runPromise(loadTurnstileScriptEffect({
      hasTurnstile: () => false,
      findExistingScript: () => existing,
      createScript: createScriptElement,
      appendScript: () => undefined,
    }));

    existing.fire("error");
    await expect(promise).rejects.toThrow("Turnstile script failed to load");
  });
});
