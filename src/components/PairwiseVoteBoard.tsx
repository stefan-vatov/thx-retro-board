import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { Columns3 } from "lucide-react";
import type { RoomState, VoteTarget } from "../domain";
import {
  getDecisionTargets,
  getPairwiseChoice,
  getPairwiseComparisons,
  voteTargetKey,
} from "../domain";
import { PairwiseOption } from "./PairwiseOption";
import {
  PairwiseColumnBreakdown,
  PairwiseProgressPanel,
  PairwiseProgressSummary,
} from "./PairwiseProgress";
import {
  buildPairwiseChoiceCommandEffect,
  shouldPulsePairwiseProgressEffect,
} from "./pairwise-vote-effect";

interface PairwiseVoteBoardProps {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
  pendingPairwiseKey: string | null;
  setPendingPairwiseKey: (key: string | null) => void;
}

export function PairwiseVoteBoard({
  roomState,
  participantId,
  send,
  serverError,
  clearServerError,
  pendingPairwiseKey,
  setPendingPairwiseKey,
}: PairwiseVoteBoardProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingWinnerKey, setPendingWinnerKey] = useState<string | null>(null);
  const [progressPulse, setProgressPulse] = useState(false);
  const previousAnsweredCount = useRef<number | null>(null);
  const comparisons = getPairwiseComparisons(roomState);
  const decisionTargets = getDecisionTargets(roomState);
  const answeredCount = comparisons.filter(
    (comparison) =>
      getPairwiseChoice(
        roomState.pairwiseChoices ?? [],
        participantId,
        comparison.left.target,
        comparison.right.target,
      ) !== null,
  ).length;
  const participantProgress = roomState.participants.map((participant) => {
    const serverProgress = roomState.pairwiseProgress?.find(
      (progress) => progress.participantId === participant.id,
    );
    const answered =
      serverProgress?.answered ??
      (participant.id === participantId ? answeredCount : 0);
    const total = serverProgress?.total ?? comparisons.length;
    const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
    return {
      participant,
      answered,
      total,
      percent,
      complete: total > 0 && answered === total,
    };
  });
  const totalParticipantPairs = participantProgress.reduce(
    (sum, progress) => sum + progress.total,
    0,
  );
  const totalAnsweredParticipantPairs = participantProgress.reduce(
    (sum, progress) => sum + progress.answered,
    0,
  );
  const teamPercent =
    totalParticipantPairs === 0
      ? 0
      : Math.round(
          (totalAnsweredParticipantPairs / totalParticipantPairs) * 100,
        );
  const allParticipantsComplete =
    participantProgress.length > 0 &&
    participantProgress.every((progress) => progress.complete);
  const columnSummaries = [...roomState.columns]
    .sort((a, b) => a.order - b.order)
    .map((column) => ({
      id: column.id,
      name: column.name,
      targetCount: decisionTargets.filter(
        (target) => target.columnId === column.id,
      ).length,
    }));
  const isComplete =
    comparisons.length > 0 && answeredCount === comparisons.length;
  const activeComparison =
    comparisons.find(
      (comparison) =>
        getPairwiseChoice(
          roomState.pairwiseChoices ?? [],
          participantId,
          comparison.left.target,
          comparison.right.target,
        ) === null,
    ) ?? null;
  const leftColumnName = activeComparison
    ? (roomState.columns.find(
        (column) => column.id === activeComparison.left.columnId,
      )?.name ?? "Column")
    : "Column";
  const rightColumnName = activeComparison
    ? (roomState.columns.find(
        (column) => column.id === activeComparison.right.columnId,
      )?.name ?? "Column")
    : "Column";
  const comparisonScope = activeComparison
    ? leftColumnName === rightColumnName
      ? leftColumnName
      : `${leftColumnName} vs ${rightColumnName}`
    : "Whole board";

  useEffect(() => {
    setPendingPairwiseKey(null);
  }, [roomState.version, setPendingPairwiseKey]);

  useEffect(() => {
    if (serverError) setPendingPairwiseKey(null);
  }, [serverError, setPendingPairwiseKey]);

  useEffect(() => {
    const shouldPulse = Effect.runSync(
      shouldPulsePairwiseProgressEffect(
        previousAnsweredCount.current,
        answeredCount,
      ),
    );
    if (shouldPulse) {
      setProgressPulse(true);
      const timeout = window.setTimeout(() => setProgressPulse(false), 700);
      previousAnsweredCount.current = answeredCount;
      return () => window.clearTimeout(timeout);
    }
    previousAnsweredCount.current = answeredCount;
    return undefined;
  }, [answeredCount]);

  function choose(winner: VoteTarget, loser: VoteTarget) {
    if (!activeComparison) return;
    clearServerError?.();
    setLocalError(null);
    const sent = send(
      Effect.runSync(buildPairwiseChoiceCommandEffect(winner, loser)),
    );
    if (!sent) {
      setLocalError(
        "Ranking choice not sent. Please try again once the room is connected.",
      );
      return;
    }
    setPendingWinnerKey(voteTargetKey(winner));
    setPendingPairwiseKey(activeComparison.key);
  }

  if (comparisons.length === 0 || activeComparison === null) {
    if (isComplete) {
      return (
        <div className="pairwise-vote-board">
          <PairwiseProgressSummary
            progressPulse={progressPulse}
            answeredCount={answeredCount}
            total={comparisons.length}
          />
          <section
            className="pairwise-comparison-card pairwise-comparison-card--complete"
            aria-label="Pairwise ranking complete"
          >
            <div className="pairwise-comparison-card__header">
              <span className="vote-column__eyebrow">
                <Columns3 size={13} aria-hidden="true" />
                Ranking complete
              </span>
              <h3>All comparisons are complete</h3>
              <p>
                The facilitator can advance to review when the team is ready.
                Results are ranked by comparison wins.
              </p>
            </div>
            <ol
              className="pairwise-summary-list"
              aria-label="Completed pairwise choices"
            >
              {comparisons.map((comparison) => {
                const choice = getPairwiseChoice(
                  roomState.pairwiseChoices ?? [],
                  participantId,
                  comparison.left.target,
                  comparison.right.target,
                );
                const winnerLabel =
                  choice && sameTarget(choice.winner, comparison.left.target)
                    ? comparison.left.label
                    : comparison.right.label;
                const loserLabel =
                  choice && sameTarget(choice.winner, comparison.left.target)
                    ? comparison.right.label
                    : comparison.left.label;
                return (
                  <li key={comparison.key}>
                    <span>{winnerLabel}</span>
                    <small>ranked over {loserLabel}</small>
                  </li>
                );
              })}
            </ol>
          </section>
          <PairwiseProgressPanel
            progress={participantProgress}
            teamPercent={teamPercent}
            allComplete={allParticipantsComplete}
            currentParticipantId={participantId}
          />
          <PairwiseColumnBreakdown
            summaries={columnSummaries}
            totalPairs={comparisons.length}
            answeredPairs={answeredCount}
          />
        </div>
      );
    }
    return (
      <div className="empty-state">
        <div
          className="empty-state__icon empty-state__icon--vote"
          aria-hidden="true"
        >
          Rank
        </div>
        <p className="empty-state__text">No pairwise comparisons yet.</p>
        <p className="empty-state__subtext">
          Pairwise ranking needs at least two decision targets. Groups and
          ungrouped cards are compared across the whole board.
        </p>
        <PairwiseProgressPanel
          progress={participantProgress}
          teamPercent={teamPercent}
          allComplete={allParticipantsComplete}
          currentParticipantId={participantId}
        />
        <PairwiseColumnBreakdown
          summaries={columnSummaries}
          totalPairs={comparisons.length}
          answeredPairs={answeredCount}
        />
      </div>
    );
  }

  const selectedChoice = getPairwiseChoice(
    roomState.pairwiseChoices ?? [],
    participantId,
    activeComparison.left.target,
    activeComparison.right.target,
  );
  const isPending = pendingPairwiseKey === activeComparison.key;

  return (
    <div className="pairwise-vote-board">
      <div
        className={`vote-budget-bar${progressPulse ? " vote-budget-bar--pulse" : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className="vote-budget-bar__label">Pairwise ranking:</span>
        <span className="vote-budget-bar__value">
          {answeredCount} of {comparisons.length} comparisons complete
        </span>
        <span className="vote-budget-bar__remaining">({comparisonScope})</span>
      </div>
      {(localError || serverError) && (
        <div className="status-msg status-msg--error vote-error" role="alert">
          {localError ?? serverError}
        </div>
      )}
      <PairwiseProgressPanel
        progress={participantProgress}
        teamPercent={teamPercent}
        allComplete={allParticipantsComplete}
        currentParticipantId={participantId}
      />
      <section
        key={activeComparison.key}
        className="pairwise-comparison-card pairwise-comparison-card--enter"
        aria-label={`Pairwise comparison: ${comparisonScope}`}
      >
        <div className="pairwise-comparison-card__header">
          <span className="vote-column__eyebrow">
            <Columns3 size={13} aria-hidden="true" />
            {comparisonScope}
          </span>
          <h3>Which should rank higher?</h3>
          <p>
            Choose the stronger discussion target. Groups and ungrouped cards
            are ranked against every other target on the board.
          </p>
        </div>
        <div className="pairwise-options">
          <PairwiseOption
            roomState={roomState}
            participantId={participantId}
            send={send}
            target={activeComparison.left.target}
            label={activeComparison.left.label}
            columnName={leftColumnName}
            selected={
              selectedChoice
                ? sameTarget(
                    selectedChoice.winner,
                    activeComparison.left.target,
                  )
                : false
            }
            pending={
              isPending &&
              pendingWinnerKey === voteTargetKey(activeComparison.left.target)
            }
            disabled={isPending}
            onChoose={() =>
              choose(
                activeComparison.left.target,
                activeComparison.right.target,
              )
            }
          />
          <span className="pairwise-options__divider" aria-hidden="true">
            or
          </span>
          <PairwiseOption
            roomState={roomState}
            participantId={participantId}
            send={send}
            target={activeComparison.right.target}
            label={activeComparison.right.label}
            columnName={rightColumnName}
            selected={
              selectedChoice
                ? sameTarget(
                    selectedChoice.winner,
                    activeComparison.right.target,
                  )
                : false
            }
            pending={
              isPending &&
              pendingWinnerKey === voteTargetKey(activeComparison.right.target)
            }
            disabled={isPending}
            onChoose={() =>
              choose(
                activeComparison.right.target,
                activeComparison.left.target,
              )
            }
          />
        </div>
      </section>
      <PairwiseColumnBreakdown
        summaries={columnSummaries}
        totalPairs={comparisons.length}
        answeredPairs={answeredCount}
      />
    </div>
  );
}

function sameTarget(left: VoteTarget, right: VoteTarget): boolean {
  return left.type === right.type && left.id === right.id;
}
