import { ArrowRight, Clock3, Loader2, Save, ShieldCheck, Trash2, Vote } from "lucide-react";
import type { Phase, RoomState } from "../domain";
import { PHASE_LABELS } from "./room-labels";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type FacilitatorControlsProps = {
  roomState: RoomState | null;
  nextPhase: Phase | undefined;
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
  onVoteBudgetChange: (value: string) => void;
  onSetBudget: () => void;
  onAdvancePhase: () => void;
  onTimerMinutesChange: (value: string) => void;
  onSetTimer: () => void;
  onPurgeRoom: () => void;
};

export function FacilitatorControls(props: FacilitatorControlsProps) {
  const showBudget = props.roomState?.rankingMethod !== "pairwise" && props.roomState?.phase === "setup";
  const budgetError = props.budgetMsg?.includes("must be") === true;

  return (
    <Card className="facilitator-panel" role="region" aria-label="Facilitator controls">
      <CardHeader className="px-0">
        <div className="facilitator-panel__heading">
          <CardTitle className="facilitator-panel__title">
            <ShieldCheck aria-hidden="true" size={14} />
            Facilitator controls
          </CardTitle>
          <CardDescription>Run the retro without exposing participant credentials.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="facilitator-panel__controls px-0">
        {showBudget && (
          <div className="facilitator-panel__row">
            <label className="input-label" htmlFor="voteBudget">
              <Vote aria-hidden="true" size={14} />
              Vote Budget
            </label>
            <Input
              id="voteBudget"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={props.voteBudgetInput}
              onChange={(event) => props.onVoteBudgetChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  props.onSetBudget();
                }
              }}
              className={`input facilitator-panel__number-input${budgetError ? " input--error" : ""}`}
              aria-describedby={budgetError ? "budget-error" : undefined}
              aria-invalid={budgetError ? "true" : undefined}
            />
            <Button variant="secondary" size="sm" onClick={props.onSetBudget} disabled={props.budgetPending} aria-busy={props.budgetPending}>
              {props.budgetPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {props.budgetPending ? "Saving…" : "Set"}
            </Button>
            {budgetError ? (
              <span id="budget-error" className="status-msg status-msg--error facilitator-panel__message" role="alert">{props.budgetMsg}</span>
            ) : props.budgetMsg ? (
              <span className="status-msg status-msg--info facilitator-panel__message" role="status">{props.budgetMsg}</span>
            ) : null}
          </div>
        )}

        <div className="facilitator-panel__row">
          <Button
            onClick={props.onAdvancePhase}
            disabled={props.roomState?.phase === "finalize" || props.phasePending}
            aria-busy={props.phasePending}
            aria-label={props.nextPhase ? `Advance to ${PHASE_LABELS[props.nextPhase]} phase` : "Advance phase"}
          >
            {props.phasePending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {props.phasePending ? "Advancing…" : props.nextPhase ? `Advance to ${PHASE_LABELS[props.nextPhase]}` : "Complete"}
          </Button>
          {props.phaseMsg && <span className="status-msg status-msg--info facilitator-panel__message" role="status">{props.phaseMsg}</span>}
        </div>

        <div className="facilitator-panel__row">
          <label className="input-label" htmlFor="timerMinutes">
            <Clock3 aria-hidden="true" size={14} />
            Timer (minutes)
          </label>
          <Input
            id="timerMinutes"
            type="number"
            min={1}
            max={60}
            value={props.timerMinutesInput}
            onChange={(event) => props.onTimerMinutesChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                props.onSetTimer();
              }
            }}
            className={`input facilitator-panel__number-input${props.timerInputError ? " input--error" : ""}`}
            aria-describedby={props.timerInputError ? "timer-error" : undefined}
            aria-invalid={props.timerInputError ? "true" : undefined}
          />
          <Button variant="secondary" size="sm" onClick={props.onSetTimer} disabled={props.timerPending} aria-busy={props.timerPending}>
            {props.timerPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            {props.timerPending ? "Starting…" : "Start Timer"}
          </Button>
          {props.timerInputError && <span id="timer-error" className="status-msg status-msg--error facilitator-panel__message" role="alert">{props.timerInputError}</span>}
          {props.timerMsg && !props.timerInputError && <span className="status-msg status-msg--info facilitator-panel__message" role="status">{props.timerMsg}</span>}
        </div>

        <div className="facilitator-panel__row facilitator-panel__row--danger">
          <Button type="button" variant="ghost" size="sm" className="room-delete-button" onClick={props.onPurgeRoom} disabled={props.purgePending} aria-busy={props.purgePending}>
            {props.purgePending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {props.purgePending ? "Deleting…" : "Delete room data"}
          </Button>
          <span className="facilitator-panel__message text-muted">Rooms also auto-delete one hour after the last active participant leaves.</span>
          {props.purgeMsg && <span className="status-msg status-msg--error facilitator-panel__message" role="alert">{props.purgeMsg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
