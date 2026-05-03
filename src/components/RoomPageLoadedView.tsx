import type { RefObject } from "react";
import type { Phase, RankingMethod, RoomState } from "../domain";
import type { useRoom } from "../hooks";
import { FacilitatorControls } from "./FacilitatorControls";
import { RoomBoardArea } from "./RoomBoardArea";
import { RoomShellHeader, RoomStatus } from "./RoomShell";
import type { useWriteCards } from "./use-write-cards";

type RoomPageLoadedViewProps = {
  roomId: string;
  roomState: RoomState | null;
  connected: boolean;
  participantId: string;
  columnCount: number;
  nextPhase: Phase | undefined;
  phaseStatusRef: RefObject<HTMLDivElement | null>;
  realtime: Pick<
    ReturnType<typeof useRoom>,
    "lastError" | "clearError" | "send"
  >;
  facilitatorControls: {
    voteBudgetInput: string;
    budgetMsg: string | null;
    budgetPending: boolean;
    phaseMsg: string | null;
    phasePending: boolean;
    timerMinutesInput: string;
    timerMsg: string | null;
    timerInputError: string | null;
    timerPending: boolean;
    purgeMsg: string | null;
    purgePending: boolean;
    onVoteBudgetChange(value: string): void;
    onSetBudget(): void;
    onAdvancePhase(): void;
    onTimerMinutesChange(value: string): void;
    onSetTimer(): void;
    onPurgeRoom(): void;
  };
  ranking: {
    pending: boolean;
    message: string | null;
    onMethodChange(rankingMethod: RankingMethod): void;
  };
  writeCards: ReturnType<typeof useWriteCards>;
};

export function RoomPageLoadedView({
  roomId,
  roomState,
  connected,
  participantId,
  columnCount,
  nextPhase,
  phaseStatusRef,
  realtime,
  facilitatorControls,
  ranking,
  writeCards,
}: RoomPageLoadedViewProps) {
  const currentParticipant = roomState?.participants.find(
    (participant) => participant.id === participantId,
  );
  const isFacilitator = currentParticipant?.isFacilitator === true;

  return (
    <div className="content-shell">
      <RoomShellHeader roomId={roomId} connected={connected} />

      <RoomStatus
        roomState={roomState}
        columnCount={columnCount}
        participantId={participantId}
        phaseStatusRef={phaseStatusRef}
      />

      {isFacilitator && (
        <FacilitatorControls
          roomState={roomState}
          nextPhase={nextPhase}
          voteBudgetInput={facilitatorControls.voteBudgetInput}
          budgetMsg={facilitatorControls.budgetMsg}
          budgetPending={facilitatorControls.budgetPending}
          phaseMsg={facilitatorControls.phaseMsg}
          phasePending={facilitatorControls.phasePending}
          timerMinutesInput={facilitatorControls.timerMinutesInput}
          timerMsg={facilitatorControls.timerMsg}
          timerInputError={facilitatorControls.timerInputError}
          timerPending={facilitatorControls.timerPending}
          purgeMsg={facilitatorControls.purgeMsg}
          purgePending={facilitatorControls.purgePending}
          onVoteBudgetChange={facilitatorControls.onVoteBudgetChange}
          onSetBudget={facilitatorControls.onSetBudget}
          onAdvancePhase={facilitatorControls.onAdvancePhase}
          onTimerMinutesChange={facilitatorControls.onTimerMinutesChange}
          onSetTimer={facilitatorControls.onSetTimer}
          onPurgeRoom={facilitatorControls.onPurgeRoom}
        />
      )}

      <RoomBoardArea
        roomState={roomState}
        isFacilitator={isFacilitator}
        participantId={participantId}
        connected={connected}
        send={realtime.send}
        serverError={realtime.lastError}
        clearServerError={realtime.clearError}
        onRankingMethodChange={ranking.onMethodChange}
        rankingPending={ranking.pending}
        rankingMsg={ranking.message}
        writeCards={writeCards}
      />

      <footer className="room-footer" role="contentinfo">
        <span className="room-footer__label">Room</span>
        <span className="room-footer__code truncate" aria-label="Room code">
          {roomId}
        </span>
      </footer>
    </div>
  );
}
