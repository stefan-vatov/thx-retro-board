import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  loadTurnstileScriptEffect,
  removeTurnstileWidgetEffect,
  renderTurnstileWidgetEffect,
} from "./turnstile-effect";

declare global {
  interface Window {
    turnstile?: {
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
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey: string;
  onTokenChange: (token: string | null) => void;
}

function loadTurnstileScript(): Promise<void> {
  return Effect.runPromise(
    loadTurnstileScriptEffect({
      hasTurnstile: () => Boolean(window.turnstile),
      findExistingScript: () =>
        document.getElementById(
          "cloudflare-turnstile-script",
        ) as HTMLScriptElement | null,
      createScript: () => document.createElement("script"),
      appendScript: (script) =>
        document.head.appendChild(script as HTMLScriptElement),
    }),
  );
}

export function TurnstileWidget({
  siteKey,
  onTokenChange,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    onTokenChange(null);

    void loadChallenge();

    async function loadChallenge() {
      try {
        await loadTurnstileScript();
      } catch {
        if (!disposed) {
          onTokenChange(null);
          setLoadError(
            "Verification could not load. Please refresh and try again.",
          );
        }
        return;
      }
      if (disposed || !containerRef.current) return;
      widgetIdRef.current = await Effect.runPromise(
        renderTurnstileWidgetEffect({
          container: containerRef.current,
          siteKey,
          onTokenChange,
          setLoadError,
          turnstile: window.turnstile,
        }),
      );
    }

    return () => {
      disposed = true;
      onTokenChange(null);
      void Effect.runPromise(
        removeTurnstileWidgetEffect(widgetIdRef.current, window.turnstile),
      );
      widgetIdRef.current = null;
    };
  }, [onTokenChange, siteKey]);

  return (
    <div className="turnstile-box" aria-label="Bot protection">
      <div ref={containerRef} />
      {loadError && (
        <p className="turnstile-box__error" role="alert">
          {loadError}
        </p>
      )}
    </div>
  );
}
