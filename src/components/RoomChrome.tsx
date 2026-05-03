import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  AlertTriangle,
  ClipboardCheck,
  Columns3,
  Copy,
} from "lucide-react";
import type { Phase, RoomState } from "../domain";
import { PHASE_ORDER } from "../domain";
import { PHASE_LABELS } from "./room-labels";
import { formatElapsedTimeEffect } from "./room-session";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { writeClipboardText } from "./clipboard-effect";

export function TimerDisplay({ timer }: { timer: RoomState["timer"] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer.startedAt === null || timer.durationSeconds === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timer.startedAt, timer.durationSeconds]);

  if (timer.startedAt === null || timer.durationSeconds === null) {
    return <span className="timer-display">No timer set</span>;
  }

  const elapsed = (now - timer.startedAt) / 1000;
  const remaining = Math.max(0, timer.durationSeconds - elapsed);
  const expired = remaining <= 0;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <span className={`timer-display${expired ? " timer-display--expired" : " timer-display--running"}`}>
      {expired ? "Timer expired" : `${mins}:${secs.toString().padStart(2, "0")} remaining`}
    </span>
  );
}

function ElapsedRetroClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <span className="elapsed-clock">{Effect.runSync(formatElapsedTimeEffect(Math.max(0, now - startedAt)))}</span>;
}

export function PhaseProgress({ phase, startedAt }: { phase: Phase; startedAt: number }) {
  const currentIndex = PHASE_ORDER.indexOf(phase);

  return (
    <Card className="retro-progress" role="region" aria-label="Retro progress">
      <div className="retro-progress__header">
        <span className="retro-progress__label">Retro progress</span>
        <span className="retro-progress__elapsed" aria-label="Retro elapsed time">
          Running for <ElapsedRetroClock startedAt={startedAt} />
        </span>
      </div>
      <ol className="retro-steps" aria-label="Retro steps">
        {PHASE_ORDER.map((step, index) => {
          const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          return (
            <li key={step} className={`retro-step retro-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="retro-step__dot" aria-hidden="true">{index + 1}</span>
              <span className="retro-step__label">{PHASE_LABELS[step]}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <Badge
      variant="secondary"
      className="connection-badge"
      aria-live="polite"
      aria-label={connected ? "Connected" : "Disconnected"}
    >
      <span
        className={`connection-dot ${connected ? "connection-dot--connected" : "connection-dot--disconnected"}`}
        aria-hidden="true"
      />
      <span className="connection-badge__text">{connected ? "Connected" : "Disconnected"}</span>
    </Badge>
  );
}

export function InviteButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copySupported] = useState(() => typeof navigator !== "undefined" && typeof navigator.clipboard !== "undefined");
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (manualUrl) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [manualUrl]);

  async function handleInvite() {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    if (copySupported) {
      try {
        await writeClipboardText(inviteUrl, navigator.clipboard);
        setCopied(true);
        setCopyFailed(false);
        setManualUrl(null);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopied(false);
        setCopyFailed(true);
        setManualUrl(inviteUrl);
      }
    } else {
      setCopied(false);
      setCopyFailed(true);
      setManualUrl(inviteUrl);
    }
  }

  const accessibleLabel = copied
    ? "Room invite link copied!"
    : copyFailed
    ? "Copy failed — select the URL below"
    : "Copy room invite link";

  return (
    <div className="invite-control">
      <Button
        ref={buttonRef}
        variant={copied ? "default" : copyFailed ? "destructive" : "secondary"}
        size="sm"
        className={`invite-btn${copied ? " invite-btn--copied" : ""}`}
        onClick={handleInvite}
        aria-label={accessibleLabel}
        type="button"
      >
        {copied ? <ClipboardCheck aria-hidden="true" /> : copyFailed ? <AlertTriangle aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied!" : copyFailed ? "Error" : "Invite"}
      </Button>
      {manualUrl && (
        <div className="invite-control__fallback" role="alert">
          <span>Copy failed. Select this safe room URL manually:</span>
          <Input
            ref={manualInputRef}
            type="text"
            readOnly
            value={manualUrl}
            aria-label="Room invite URL — select and copy manually"
            className="h-8 w-[min(18rem,80vw)] text-xs"
            onClick={(event) => (event.target as HTMLInputElement).select()}
          />
        </div>
      )}
    </div>
  );
}

export function ParticipantList({ participants, currentId }: { participants: RoomState["participants"]; currentId: string }) {
  if (!participants || participants.length === 0) {
    return <span className="text-muted">No participants yet</span>;
  }
  return (
    <ul className="participant-list" aria-label="Participants">
      {participants.map((participant) => (
        <li key={participant.id}>
          <Badge variant={participant.id === currentId ? "default" : "secondary"} className={`participant-chip${participant.id === currentId ? " participant-chip--self" : ""}`}>
            <span className="participant-chip__name">{participant.displayName}</span>
            {participant.isFacilitator && (
              <span className="facilitator-badge facilitator-badge--sm" aria-label={`${participant.displayName} is facilitator`}>
                Facilitator
              </span>
            )}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function EmptyColumnsNotice() {
  return (
    <Alert>
      <Columns3 aria-hidden="true" />
      <AlertDescription>Ask the facilitator to configure columns before adding retro items.</AlertDescription>
    </Alert>
  );
}
