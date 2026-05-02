import { Effect } from "effect";

export const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

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

export function loadTurnstileScriptEffect(env: TurnstileScriptEnv): Effect.Effect<void, Error> {
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

function waitForScriptEffect(script: TurnstileScriptElement): Effect.Effect<void, Error> {
  return Effect.async<void, Error>((resume) => {
    script.addEventListener("load", () => resume(Effect.void), { once: true });
    script.addEventListener("error", () => resume(Effect.fail(new Error("Turnstile script failed to load"))), { once: true });
  });
}
