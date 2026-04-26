import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { createRoom } from "../api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom();
      navigate(`/room/${roomId}`);
    } catch {
      setError("Failed to create room. Please check your connection and try again.");
      setCreating(false);
      createButtonRef.current?.focus();
    }
  }

  return (
    <main className="home-hero" aria-labelledby="home-title">
      <section className="home-hero__content" aria-label="Retro Board introduction">
        <div className="home-hero__eyebrow">
          <Sparkles aria-hidden="true" size={16} />
          Clean, timed retrospectives
        </div>
        <h1 id="home-title" className="home-hero__title">Retro Board</h1>
        <p className="home-hero__copy">
          Create a private room, invite your team, and move from writing to organising, voting, and review without exposing participant credentials.
        </p>
        <div className="home-hero__proof" aria-label="Product highlights">
          <span><UsersRound aria-hidden="true" size={16} /> Realtime collaboration</span>
          <span><ShieldCheck aria-hidden="true" size={16} /> Safe invite links</span>
        </div>
      </section>

      <Card className="home-create-card">
        <CardHeader className="text-center">
          <div className="home-create-card__icon" aria-hidden="true">📋</div>
          <CardTitle className="text-2xl">Start a room</CardTitle>
          <CardDescription>
            You will become the facilitator and can share an invite after joining.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            ref={createButtonRef}
            size="lg"
            className="h-12 w-full text-base"
            onClick={handleCreate}
            disabled={creating}
            aria-busy={creating}
          >
            {creating ? (
              <>
                <Loader2 className="loading-spinner" aria-hidden="true" />
                Creating room…
              </>
            ) : (
              <>
                Create Room
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
          {creating && (
            <p className="home-create-card__status" role="status" aria-live="polite">
              Creating a private room and preparing your facilitator join screen…
            </p>
          )}
          {error && (
            <Alert variant="destructive">
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
        </CardContent>
      </Card>
    </main>
  );
}
