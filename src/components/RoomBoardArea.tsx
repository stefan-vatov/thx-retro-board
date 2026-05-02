import { Columns3 } from "lucide-react";
import type { RankingMethod, RoomState } from "../domain";
import { FinalBoard } from "./FinalBoard";
import { OrganiseBoard } from "./OrganiseBoard";
import { ReviewBoard } from "./ReviewBoard";
import { SetupBoard } from "./SetupBoard";
import { VoteBoard } from "./VoteBoard";
import type { useWriteCards } from "./use-write-cards";
import { WriteColumnBoard } from "./WriteColumnBoard";
import { Card } from "./ui/card";

type RoomBoardAreaProps = {
  roomState: RoomState | null;
  isFacilitator: boolean;
  participantId: string;
  connected: boolean;
  send: (message: unknown) => boolean;
  serverError: string | null;
  clearServerError: () => void;
  onRankingMethodChange: (rankingMethod: RankingMethod) => void;
  rankingPending: boolean;
  rankingMsg: string | null;
  writeCards: ReturnType<typeof useWriteCards>;
};

export function RoomBoardArea(props: RoomBoardAreaProps) {
  return (
    <Card className="board-area glass-panel">
      <div className="board-header">
        <div>
          <h2 className="board-title">
            <Columns3 aria-hidden="true" size={18} />
            Board
          </h2>
          <p className="board-subtitle">Capture, sort, vote, and review feedback in one shared room.</p>
        </div>
        {props.roomState?.phase === "setup" && (
          <span className="phase-hint" aria-hidden="true">
            {props.isFacilitator ? "Configure once, then lock" : "Waiting for facilitator"}
          </span>
        )}
        {props.roomState?.phase === "write" && <span className="phase-hint" aria-hidden="true">Write privately, discuss together</span>}
      </div>

      {props.roomState?.phase === "write" && props.writeCards.columnErrors.__global && (
        <div className="status-msg status-msg--error write-global-error" role="alert">
          {props.writeCards.columnErrors.__global}
        </div>
      )}

      {props.roomState?.phase === "setup" ? (
        <SetupBoard
          roomState={props.roomState}
          isFacilitator={props.isFacilitator}
          send={props.send}
          serverError={props.serverError}
          clearServerError={props.clearServerError}
          onRankingMethodChange={props.onRankingMethodChange}
          rankingPending={props.rankingPending}
          rankingMsg={props.rankingMsg}
        />
      ) : props.roomState?.phase === "organise" ? (
        <OrganiseBoard
          roomState={props.roomState}
          isFacilitator={props.isFacilitator}
          participantId={props.participantId}
          send={props.send}
          serverError={props.serverError}
          clearServerError={props.clearServerError}
        />
      ) : props.roomState?.phase === "vote" ? (
        <VoteBoard roomState={props.roomState} participantId={props.participantId} send={props.send} serverError={props.serverError} clearServerError={props.clearServerError} />
      ) : props.roomState?.phase === "review" ? (
        <ReviewBoard
          roomState={props.roomState}
          participantId={props.participantId}
          isFacilitator={props.isFacilitator}
          send={props.send}
          serverError={props.serverError}
          clearServerError={props.clearServerError}
        />
      ) : props.roomState?.phase === "finalize" ? (
        <FinalBoard roomState={props.roomState} />
      ) : props.roomState?.phase === "write" ? (
        <WriteColumnBoard
          roomState={props.roomState}
          participantId={props.participantId}
          connected={props.connected}
          send={props.send}
          columnInputs={props.writeCards.columnInputs}
          columnErrors={props.writeCards.columnErrors}
          pendingColumnId={props.writeCards.pendingColumnId}
          editingItemId={props.writeCards.editingItemId}
          editingItemText={props.writeCards.editingItemText}
          pendingItemId={props.writeCards.pendingItemId}
          onColumnInputChange={props.writeCards.handleColumnInputChange}
          onAddItem={props.writeCards.handleAddItem}
          onStartEdit={props.writeCards.handleStartEditItem}
          onEditTextChange={props.writeCards.setEditingItemText}
          onSubmitEdit={props.writeCards.handleSubmitEditItem}
          onCancelEdit={props.writeCards.handleCancelEditItem}
          onDeleteItem={props.writeCards.handleDeleteItem}
          columnInputRefs={props.writeCards.columnInputRefs}
        />
      ) : null}
    </Card>
  );
}
