import { AlertTriangle, DoorOpen, Loader2, RefreshCw } from "lucide-react";
import type { RoomLoadError } from "./room-session";
import { submitFormOnModEnter } from "./form-shortcuts";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

export function LoadingRoomScreen() {
  return (
    <main className="state-surface" aria-labelledby="loading-title">
      <Card className="state-card loading-state" role="status" aria-label="Loading room">
        <CardHeader className="items-center text-center">
          <div className="state-card__icon" aria-hidden="true">
            <Loader2 className="loading-spinner" />
          </div>
          <CardTitle id="loading-title" role="heading" aria-level={1}>Loading room…</CardTitle>
          <CardDescription>Checking the room and restoring your local identity if one exists.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

export function RoomNotFoundScreen() {
  return (
    <main className="state-surface" aria-labelledby="not-found-title">
      <Card className="state-card empty-state">
        <CardHeader className="items-center text-center">
          <div className="state-card__icon" role="img" aria-label="Room not found">🔍</div>
          <CardTitle id="not-found-title" role="heading" aria-level={1} className="text-2xl">Room Not Found</CardTitle>
          <CardDescription>This room does not exist, has been closed, or the link may be incorrect. Check the invite link or start a new room.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild><a href="/">Return Home</a></Button>
        </CardContent>
      </Card>
    </main>
  );
}

export function RoomLoadErrorScreen({ error, onRetry }: { error: RoomLoadError; onRetry: () => void }) {
  return (
    <main className="state-surface" aria-labelledby="room-load-error-title">
      <Card className="state-card empty-state" role="alert">
        <CardHeader className="items-center text-center">
          <div className="state-card__icon" role="img" aria-label="Room load error">
            <AlertTriangle aria-hidden="true" />
          </div>
          <CardTitle id="room-load-error-title" role="heading" aria-level={1} className="text-2xl">{error.title}</CardTitle>
          <CardDescription>{error.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <p className="text-muted">{error.detail}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Retry loading room
            </Button>
            <Button asChild variant="secondary"><a href="/">Return Home</a></Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

type JoinRoomScreenProps = {
  displayName: string;
  joinError: string | null;
  joinLoading: boolean;
  onDisplayNameChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
};

export function JoinRoomScreen({ displayName, joinError, joinLoading, onDisplayNameChange, onSubmit }: JoinRoomScreenProps) {
  return (
    <main className="state-surface" aria-labelledby="join-title">
      <Card className="state-card join-card join-card--room">
        <CardHeader>
          <div className="join-card__badge">
            <DoorOpen aria-hidden="true" size={16} />
            Room invite
          </div>
          <CardTitle id="join-title" role="heading" aria-level={1} className="text-2xl">Join Room</CardTitle>
          <CardDescription>Enter the name teammates will see in this retrospective. Your name is stored only in this browser for reconnects.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="join-card__form">
            <div className="input-group">
              <label className="input-label" htmlFor="displayName">Display name</label>
              <Input
                id="displayName"
                className={joinError ? "input--error" : undefined}
                type="text"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                onKeyDown={submitFormOnModEnter}
                maxLength={50}
                placeholder="Alex"
                autoComplete="nickname"
                aria-required="true"
                aria-describedby={joinError ? "join-error" : undefined}
                aria-invalid={joinError ? "true" : undefined}
              />
            </div>
            <Button type="submit" className="join-card__submit" disabled={joinLoading} aria-busy={joinLoading}>
              {joinLoading ? <><Loader2 className="loading-spinner" aria-hidden="true" />Joining…</> : "Join room"}
            </Button>
            <p className="join-card__privacy">Your reconnect token stays in this browser. The invite link does not include participant credentials.</p>
            {joinLoading && <p className="join-card__status" role="status" aria-live="polite">Joining room and establishing a private reconnect token…</p>}
            {joinError && (
              <Alert id="join-error" variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Could not join</AlertTitle>
                <AlertDescription>{joinError}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
