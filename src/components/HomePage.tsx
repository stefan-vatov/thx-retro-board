import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Columns3, Loader2, ShieldCheck, Sparkles, Timer, UsersRound, Vote } from "lucide-react";
import { createRoom, getPublicConfig } from "../api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { TurnstileWidget } from "./TurnstileWidget";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    void getPublicConfig().then((config) => {
      if (!disposed) setTurnstileSiteKey(config.turnstileSiteKey);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const handleTurnstileTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  async function handleCreate() {
    if (creating) return;
    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the verification before creating a room.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { roomId, facilitatorClaimToken } = await createRoom(turnstileToken ?? undefined);
      if (facilitatorClaimToken) {
        sessionStorage.setItem(`retro-facilitator-claim-${roomId}`, facilitatorClaimToken);
      }
      navigate(`/room/${roomId}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create room. Please check your connection and try again.");
      setTurnstileToken(null);
      setTurnstileResetNonce((current) => current + 1);
      setCreating(false);
      createButtonRef.current?.focus();
    }
  }

  return (
    <main className="home-shell" aria-labelledby="home-title">
      <nav className="home-nav" aria-label="Home">
        <a className="home-nav__brand" href="/" aria-label="Retro Board home">
          <span className="home-nav__mark" aria-hidden="true">RB</span>
          <span>Retro Board</span>
        </a>
        <div className="home-nav__meta" aria-label="Product attributes">
          <span>Private rooms</span>
          <span>Live collaboration</span>
          <Button
            ref={createButtonRef}
            size="sm"
            className="home-nav__cta"
            onClick={handleCreate}
            disabled={creating || Boolean(turnstileSiteKey && !turnstileToken)}
            aria-busy={creating}
          >
            {creating ? "Creating…" : "Start"}
          </Button>
        </div>
      </nav>
      <section className="home-hero" aria-label="Retro Board introduction">
        <div className="home-hero__copy-block">
          <div className="home-hero__eyebrow">
            <Sparkles aria-hidden="true" size={16} />
            Live team retros without the ceremony
          </div>
          <h1 id="home-title" className="home-hero__title">Run better team retros.</h1>
          <p className="home-hero__copy">
            Create a private room, collect feedback, group themes, vote by column, and walk away with clear next actions.
          </p>
          <div className="home-hero__actions">
            {turnstileSiteKey && (
              <TurnstileWidget key={turnstileResetNonce} siteKey={turnstileSiteKey} onTokenChange={handleTurnstileTokenChange} />
            )}
            <Button
              ref={createButtonRef}
              size="lg"
              className="home-hero__cta"
              onClick={handleCreate}
              disabled={creating || Boolean(turnstileSiteKey && !turnstileToken)}
              aria-busy={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="loading-spinner" aria-hidden="true" />
                  Creating room…
                </>
              ) : (
                <>
                  Start a retro
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
            <span className="home-hero__secondary">
              <ShieldCheck size={16} aria-hidden="true" />
              Private invite, no account setup
            </span>
          </div>
          <div className="home-hero__proof" aria-label="Product highlights">
            <span><UsersRound aria-hidden="true" size={16} /> Realtime collaboration</span>
            <span><Timer aria-hidden="true" size={16} /> Built-in timer</span>
            <span><Vote aria-hidden="true" size={16} /> Column-aware voting</span>
          </div>
          {creating && (
            <p className="home-create-card__status" role="status" aria-live="polite">
              Creating a private room and preparing your facilitator join screen…
            </p>
          )}
          {error && (
            <Alert variant="destructive" className="home-hero__error">
              <AlertTitle>Room creation failed</AlertTitle>
              <AlertDescription>
                <p>{error}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  Try Again
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="home-product-shot" aria-hidden="true">
          <div className="home-product-shot__chrome">
            <span>Retro Board</span>
            <span>Write</span>
          </div>
          <div className="home-product-shot__status">
            <span>3 columns</span>
            <span>5 min timer</span>
            <span>5 votes</span>
          </div>
          <div className="home-product-shot__lanes">
            {[
              ["Mad", "Planning felt rushed", "Too many late handoffs"],
              ["Glad", "Demo landed smoothly", "Pairing unblocked release"],
              ["Sad", "Protect QA window", "Clarify release owner"],
            ].map(([title, first, second]) => (
              <div key={title} className="home-product-lane">
                <div className="home-product-lane__header">
                  <Columns3 size={14} />
                  <span>{title}</span>
                </div>
                <span>{first}</span>
                <span>{second}</span>
              </div>
            ))}
          </div>
          <div className="home-product-shot__footer">
            <div>
              <CheckCircle2 size={14} />
              Vote results stay tied to their column
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
