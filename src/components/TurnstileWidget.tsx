import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { loadTurnstileScriptEffect } from "./turnstile-effect";

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
  return Effect.runPromise(loadTurnstileScriptEffect({
    hasTurnstile: () => Boolean(window.turnstile),
    findExistingScript: () => document.getElementById("cloudflare-turnstile-script") as HTMLScriptElement | null,
    createScript: () => document.createElement("script"),
    appendScript: (script) => document.head.appendChild(script as HTMLScriptElement),
  }));
}

export function TurnstileWidget({ siteKey, onTokenChange }: TurnstileWidgetProps) {
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
          setLoadError("Verification could not load. Please refresh and try again.");
        }
        return;
      }
      if (disposed || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token) => onTokenChange(token),
        "expired-callback": () => onTokenChange(null),
        "error-callback": () => {
          onTokenChange(null);
          setLoadError("Verification failed. Please retry the challenge.");
        },
      });
    }

    return () => {
      disposed = true;
      onTokenChange(null);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [onTokenChange, siteKey]);

  return (
    <div className="turnstile-box" aria-label="Bot protection">
      <div ref={containerRef} />
      {loadError && <p className="turnstile-box__error" role="alert">{loadError}</p>}
    </div>
  );
}
