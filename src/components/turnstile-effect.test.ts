import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  TURNSTILE_SCRIPT_ID,
  TURNSTILE_SCRIPT_SRC,
  loadTurnstileScriptEffect,
  removeTurnstileWidgetEffect,
  renderTurnstileWidgetEffect,
  type TurnstileScriptElement,
} from "./turnstile-effect";

function createScriptElement(): TurnstileScriptElement & {
  fire: (event: "load" | "error") => void;
} {
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

    await expect(
      Effect.runPromise(
        loadTurnstileScriptEffect({
          hasTurnstile: () => true,
          findExistingScript: () => null,
          createScript: createScriptElement,
          appendScript: () => {
            appended = true;
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(appended).toBe(false);
  });

  it("creates and appends the explicit Turnstile script when missing", async () => {
    let created: ReturnType<typeof createScriptElement> | null = null;
    const promise = Effect.runPromise(
      loadTurnstileScriptEffect({
        hasTurnstile: () => false,
        findExistingScript: () => null,
        createScript: () => {
          created = createScriptElement();
          return created;
        },
        appendScript: () => undefined,
      }),
    );

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
    const promise = Effect.runPromise(
      loadTurnstileScriptEffect({
        hasTurnstile: () => false,
        findExistingScript: () => existing,
        createScript: createScriptElement,
        appendScript: () => undefined,
      }),
    );

    existing.fire("error");
    await expect(promise).rejects.toThrow("Turnstile script failed to load");
  });
});

describe("Turnstile widget effects", () => {
  it("renders a dark explicit widget and forwards challenge events", async () => {
    const tokens: Array<string | null> = [];
    let renderOptions: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    } | null = null;

    const widgetId = await Effect.runPromise(
      renderTurnstileWidgetEffect({
        container: {} as HTMLElement,
        siteKey: "site-key",
        onTokenChange: (token) => tokens.push(token),
        setLoadError: () => undefined,
        turnstile: {
          render: (_container, options) => {
            renderOptions = options;
            return "widget-1";
          },
          remove: () => undefined,
        },
      }),
    );

    renderOptions?.callback("token");
    renderOptions?.["expired-callback"]();
    renderOptions?.["error-callback"]();

    expect(widgetId).toBe("widget-1");
    expect(renderOptions).toMatchObject({
      sitekey: "site-key",
      theme: "dark",
    });
    expect(tokens).toEqual(["token", null, null]);
  });

  it("reports a load error when rendering fails", async () => {
    const errors: string[] = [];

    await expect(
      Effect.runPromise(
        renderTurnstileWidgetEffect({
          container: {} as HTMLElement,
          siteKey: "site-key",
          onTokenChange: () => undefined,
          setLoadError: (message) => errors.push(message),
          turnstile: null,
        }),
      ),
    ).resolves.toBeNull();

    expect(errors).toEqual([
      "Verification could not load. Please refresh and try again.",
    ]);
  });

  it("removes existing Turnstile widgets and ignores missing handles", async () => {
    const removed: string[] = [];

    await Effect.runPromise(
      removeTurnstileWidgetEffect("widget-1", {
        remove: (widgetId) => removed.push(widgetId),
      }),
    );
    await Effect.runPromise(removeTurnstileWidgetEffect(null, null));

    expect(removed).toEqual(["widget-1"]);
  });
});
