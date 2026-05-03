import { Effect } from "effect";

export const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface TurnstileScriptElement {
  id: string;
  src: string;
  async: boolean;
  defer: boolean;
  addEventListener: (
    event: "load" | "error",
    listener: () => void,
    options?: { once?: boolean },
  ) => void;
}

export interface TurnstileScriptEnv {
  hasTurnstile: () => boolean;
  findExistingScript: () => TurnstileScriptElement | null;
  createScript: () => TurnstileScriptElement;
  appendScript: (script: TurnstileScriptElement) => void;
}

export interface TurnstileWidgetApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

export type RenderTurnstileWidgetInput = {
  container: HTMLElement;
  siteKey: string;
  onTokenChange: (token: string | null) => void;
  setLoadError: (message: string) => void;
  turnstile: Pick<TurnstileWidgetApi, "render"> | null | undefined;
};

export function loadTurnstileScriptEffect(
  env: TurnstileScriptEnv,
): Effect.Effect<void, Error> {
  if (env.hasTurnstile()) return Effect.void;

  const existing = env.findExistingScript();
  if (existing) return waitForScriptEffect(existing);

  return Effect.gen(function* () {
    const script = env.createScript();
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    const loaded = waitForScriptEffect(script);
    env.appendScript(script);
    return yield* loaded;
  });
}

export function renderTurnstileWidgetEffect({
  container,
  siteKey,
  onTokenChange,
  setLoadError,
  turnstile,
}: RenderTurnstileWidgetInput): Effect.Effect<string | null> {
  return Effect.sync(() => {
    if (!turnstile) {
      setLoadError(
        "Verification could not load. Please refresh and try again.",
      );
      return null;
    }

    return turnstile.render(container, {
      sitekey: siteKey,
      theme: "dark",
      callback: (token) => onTokenChange(token),
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => {
        onTokenChange(null);
        setLoadError("Verification failed. Please retry the challenge.");
      },
    });
  });
}

export function removeTurnstileWidgetEffect(
  widgetId: string | null,
  turnstile: Pick<TurnstileWidgetApi, "remove"> | null | undefined,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (widgetId && turnstile) {
      turnstile.remove(widgetId);
    }
  });
}

function waitForScriptEffect(
  script: TurnstileScriptElement,
): Effect.Effect<void, Error> {
  return Effect.async<void, Error>((resume) => {
    script.addEventListener("load", () => resume(Effect.void), { once: true });
    script.addEventListener(
      "error",
      () => resume(Effect.fail(new Error("Turnstile script failed to load"))),
      { once: true },
    );
  });
}
