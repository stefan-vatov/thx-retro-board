import { Radar, ShieldCheck, Users } from "lucide-react";
import type { RoomState } from "../domain";
import { PHASE_LABELS } from "./room-labels";
import { ConnectionStatus, InviteButton, ParticipantList, PhaseProgress, TimerDisplay } from "./RoomChrome";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

type RoomShellHeaderProps = {
  roomId: string;
  connected: boolean;
};

type RoomStatusProps = {
  roomState: RoomState | null;
  columnCount: number;
  participantId: string;
  phaseStatusRef: React.RefObject<HTMLDivElement | null>;
};

export function RoomShellHeader({ roomId, connected }: RoomShellHeaderProps) {
  return (
    <header className="room-header" role="banner">
      <div className="room-header__left">
        <div className="room-header__brand" aria-hidden="true">RB</div>
        <div>
          <h1 className="room-header__title">Retro Board</h1>
          <p className="room-header__subtitle">Timed team retrospective</p>
        </div>
        <ConnectionStatus connected={connected} />
        {!connected && (
          <Badge variant="secondary" role="status" aria-live="polite" className="room-header__offline">
            <Radar aria-hidden="true" />
            Reconnecting — content remains readable
          </Badge>
        )}
      </div>
      <div className="room-header__right">
        <span className="room-header__privacy">
          <ShieldCheck aria-hidden="true" />
          Safe invite
        </span>
        <InviteButton roomId={roomId} />
      </div>
    </header>
  );
}

export function RoomStatus({ roomState, columnCount, participantId, phaseStatusRef }: RoomStatusProps) {
  return (
    <>
      {roomState && <PhaseProgress phase={roomState.phase} startedAt={roomState.startedAt} />}

      <Card ref={phaseStatusRef} className="phase-status" role="region" aria-label="Room status" tabIndex={-1}>
        <div className="phase-status__metric">
          <span className="phase-status__label">Current phase</span>
          <Badge className="phase-status__value badge--phase" data-phase={roomState?.phase ?? "unknown"}>
            {roomState ? PHASE_LABELS[roomState.phase] : "Unknown"}
          </Badge>
        </div>
        <div className="phase-status__metric">
          <span className="phase-status__label">Timer</span>
          <TimerDisplay timer={roomState?.timer ?? { startedAt: null, durationSeconds: null, expired: false }} />
        </div>
        <div className="phase-status__metric">
          <span className="phase-status__label">Board</span>
          <span className="phase-status__meta">{columnCount} columns · {roomState?.items.length ?? 0} items</span>
        </div>
      </Card>

      <section className="participants-bar" role="region" aria-label="Participants">
        <h2 className="section-title">
          <Users aria-hidden="true" size={14} />
          Participants
        </h2>
        <ParticipantList participants={roomState?.participants ?? []} currentId={participantId} />
      </section>
    </>
  );
}
