import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { Columns3 } from "lucide-react";
import type { RoomState, VoteTarget } from "../domain";
import {
  getPairwiseChoice,
  getPairwiseComparisons,
  getDecisionTargets,
  getGroupedItems,
  getRemainingBudget,
  getUngroupedItems,
  getVotesByParticipant,
  getVotesForGroup,
  getVotesForTarget,
  getVotesForUngroupedItem,
  groupVoteTarget,
  itemVoteTarget,
  voteTargetKey,
} from "../domain";
import { ReactionBar } from "./Reactions";

interface VoteBoardProps {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  serverError?: string | null;
  clearServerError?: () => void;
}

export function VoteBoard({ roomState, participantId, send, serverError = null, clearServerError }: VoteBoardProps) {
  const [pendingCastCount, setPendingCastCount] = useState(0);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());
  const [pendingPairwiseKey, setPendingPairwiseKey] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const serverRemaining = getRemainingBudget(roomState.votes, participantId, roomState.voteBudget);
  const effectiveRemaining = serverRemaining - pendingCastCount;
  const used = getVotesByParticipant(roomState.votes, participantId);
  const sortedColumns = [...roomState.columns].sort((a, b) => a.order - b.order);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const sortedUngroupedItems = getUngroupedItems(roomState.items).sort((a, b) => a.order - b.order);

  const handleVote = useCallback(
    (target: VoteTarget) => {
      if (effectiveRemaining <= 0) return;
      setVoteError(null);
      clearServerError?.();
      const message = target.type === "group"
        ? { type: "cast-vote", groupId: target.id, count: 1 }
        : { type: "cast-vote", itemId: target.id, count: 1 };
      if (!send(message)) {
        setVoteError("Vote not sent. Please try again once the room is connected.");
        return;
      }
      setPendingCastCount((c) => c + 1);
    },
    [clearServerError, effectiveRemaining, send],
  );

  const handleRemoveVote = useCallback(
    (target: VoteTarget) => {
      const key = voteTargetKey(target);
      if (pendingRemoves.has(key)) return;
      setVoteError(null);
      clearServerError?.();
      const message = target.type === "group"
        ? { type: "remove-vote", groupId: target.id }
        : { type: "remove-vote", itemId: target.id };
      if (!send(message)) {
        setVoteError("Vote not removed. Please try again once the room is connected.");
        return;
      }
      setPendingRemoves((prev) => new Set(prev).add(key));
    },
    [clearServerError, pendingRemoves, send],
  );

  const serverVersionRef = useRef(roomState.version);

  useEffect(() => {
    if (serverVersionRef.current !== roomState.version) {
      serverVersionRef.current = roomState.version;
      setPendingCastCount(0);
      setPendingRemoves(new Set());
      setPendingPairwiseKey(null);
      setVoteError(null);
    }
  }, [roomState.version]);

  if (roomState.rankingMethod === "pairwise") {
    return (
      <PairwiseVoteBoard
        roomState={roomState}
        participantId={participantId}
        send={send}
        serverError={serverError}
        clearServerError={clearServerError}
        pendingPairwiseKey={pendingPairwiseKey}
        setPendingPairwiseKey={setPendingPairwiseKey}
      />
    );
  }

  function getParticipantVotesForTarget(target: VoteTarget): number {
    return roomState.votes
      .filter((v) => v.participantId === participantId)
      .filter((v) => getVotesForTarget([v], target) > 0)
      .reduce((sum, v) => sum + v.count, 0);
  }

  function renderVoteActions(target: VoteTarget, label: string, myVotes: number) {
    const targetKey = voteTargetKey(target);
    return (
      <span className="vote-actions">
        {myVotes > 0 && (
          <span className="vote-actions__mine">
            You: {myVotes}
          </span>
        )}
        <button
          className="reorder-btn"
          onClick={() => handleRemoveVote(target)}
          disabled={myVotes === 0 || pendingRemoves.has(targetKey)}
          title={`Remove one of your votes from ${label}`}
          aria-label={`Remove one of your votes from ${label}`}
        >
          −
        </button>
        <button
          className="reorder-btn"
          onClick={() => handleVote(target)}
          disabled={effectiveRemaining <= 0}
          title={`Add a vote to ${label}`}
          aria-label={`Add a vote to ${label}`}
        >
          +
        </button>
      </span>
    );
  }

  function renderGroup(group: { id: string; name: string }) {
    const target = groupVoteTarget(group.id);
    const totalVotes = getVotesForGroup(roomState.votes, group.id);
    const myVotes = getParticipantVotesForTarget(target);
    const groupItems = getGroupedItems(roomState.items, group.id);
    return (
      <div key={group.id} className="vote-target-card" data-vote-group-id={group.id}>
        <div className="group-panel__header">
          <h4 className="group-panel__title">{group.name}</h4>
          <span className="vote-target__meta">
            <span className="vote-target__total">
              {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
            </span>
            {renderVoteActions(target, group.name, myVotes)}
          </span>
        </div>
        <div className="vote-target-card__body">
        <ReactionBar roomState={roomState} target={target} participantId={participantId} send={send} label={group.name} compact />
        {groupItems.length === 0 ? (
          <p className="vote-target__empty">No items.</p>
        ) : (
          <ul className="item-list" aria-label={`Items in ${group.name}`}>
            {groupItems.map((item) => (
              <li key={item.id} className="item-row">
                <span className="item-row__text">{item.text}</span>
                <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} compact />
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    );
  }

  function renderUngroupedItem(item: { id: string; text: string }) {
    const target = itemVoteTarget(item.id);
    const totalVotes = getVotesForUngroupedItem(roomState.votes, item.id);
    const myVotes = getParticipantVotesForTarget(target);
    return (
      <div key={item.id} className="vote-target-card" data-vote-item-id={item.id}>
        <div className="group-panel__header">
          <h4 className="group-panel__title">{item.text}</h4>
          <span className="vote-target__meta">
            <span className="vote-target__total">
              {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
            </span>
            {renderVoteActions(target, item.text, myVotes)}
          </span>
        </div>
        <div className="vote-target-card__body">
          <ReactionBar roomState={roomState} target={target} participantId={participantId} send={send} label={item.text} compact />
          <p className="vote-target__empty">
            Ungrouped item
          </p>
        </div>
      </div>
    );
  }

  const columnVoteTargets = sortedColumns.map((column) => {
    const targets = [
      ...sortedGroups.filter((group) => group.columnId === column.id).map((group) => ({
        type: "group" as const,
        order: group.order,
        node: renderGroup(group),
      })),
      ...sortedUngroupedItems.filter((item) => item.columnId === column.id).map((item) => ({
        type: "item" as const,
        order: item.order,
        node: renderUngroupedItem(item),
      })),
    ].sort((a, b) => a.order - b.order || a.type.localeCompare(b.type));
    const totalVotes = [
      ...sortedGroups.filter((group) => group.columnId === column.id).map((group) => getVotesForGroup(roomState.votes, group.id)),
      ...sortedUngroupedItems.filter((item) => item.columnId === column.id).map((item) => getVotesForUngroupedItem(roomState.votes, item.id)),
    ].reduce((sum, count) => sum + count, 0);
    return { column, targets, totalVotes };
  });
  const hasVoteTargets = columnVoteTargets.some(({ targets }) => targets.length > 0);

  return (
    <div>
      <div className="vote-budget-bar" role="status" aria-live="polite">
        <span className="vote-budget-bar__label">Your votes:</span>
        <span className="vote-budget-bar__value">{used} used / {roomState.voteBudget} total</span>
        <span className={`vote-budget-bar__remaining${effectiveRemaining === 0 ? " vote-budget-bar__remaining--zero" : ""}`}>
          ({effectiveRemaining} remaining)
        </span>
      </div>
      {(voteError || serverError) && (
        <div className="status-msg status-msg--error vote-error" role="alert">
          {voteError ?? serverError}
        </div>
      )}

      {hasVoteTargets ? (
        <div className="vote-column-board" aria-label="Vote targets by column">
          {columnVoteTargets.map(({ column, targets, totalVotes }) => (
            <section key={column.id} className="vote-column" aria-labelledby={`vote-column-${column.id}`}>
              <div className="vote-column__header">
                <div>
                  <span className="vote-column__eyebrow">
                    <Columns3 size={13} aria-hidden="true" />
                    Column
                  </span>
                  <h3 id={`vote-column-${column.id}`} className="vote-column__title">{column.name}</h3>
                </div>
                <span className="vote-column__count">{totalVotes} vote{totalVotes !== 1 ? "s" : ""}</span>
              </div>
              {targets.length > 0 ? (
                <div className="vote-column__targets">
                  {targets.map((target) => target.node)}
                </div>
              ) : (
                <p className="vote-column__empty">No vote targets in this column.</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon empty-state__icon--vote" aria-hidden="true">Vote</div>
          <p className="empty-state__text">No vote targets yet.</p>
          <p className="empty-state__subtext">
            Create groups or add ungrouped items before voting, or advance when there is nothing to vote on.
          </p>
        </div>
      )}
    </div>
  );
}

function PairwiseVoteBoard({
  roomState,
  participantId,
  send,
  serverError,
  clearServerError,
  pendingPairwiseKey,
  setPendingPairwiseKey,
}: VoteBoardProps & {
  pendingPairwiseKey: string | null;
  setPendingPairwiseKey: (key: string | null) => void;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingWinnerKey, setPendingWinnerKey] = useState<string | null>(null);
  const [progressPulse, setProgressPulse] = useState(false);
  const previousAnsweredCount = useRef<number | null>(null);
  const comparisons = getPairwiseComparisons(roomState);
  const decisionTargets = getDecisionTargets(roomState);
  const answeredCount = comparisons.filter((comparison) =>
    getPairwiseChoice(roomState.pairwiseChoices ?? [], participantId, comparison.left.target, comparison.right.target) !== null,
  ).length;
  const participantProgress = roomState.participants.map((participant) => {
    const serverProgress = roomState.pairwiseProgress?.find((progress) => progress.participantId === participant.id);
    const answered = serverProgress?.answered ?? (participant.id === participantId ? answeredCount : 0);
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
  const totalParticipantPairs = participantProgress.reduce((sum, progress) => sum + progress.total, 0);
  const totalAnsweredParticipantPairs = participantProgress.reduce((sum, progress) => sum + progress.answered, 0);
  const teamPercent = totalParticipantPairs === 0 ? 0 : Math.round((totalAnsweredParticipantPairs / totalParticipantPairs) * 100);
  const allParticipantsComplete = participantProgress.length > 0 && participantProgress.every((progress) => progress.complete);
  const columnSummaries = [...roomState.columns]
    .sort((a, b) => a.order - b.order)
    .map((column) => {
      return {
        id: column.id,
        name: column.name,
        targetCount: decisionTargets.filter((target) => target.columnId === column.id).length,
      };
    });
  const isComplete = comparisons.length > 0 && answeredCount === comparisons.length;
  const activeComparison = comparisons.find((comparison) =>
    getPairwiseChoice(roomState.pairwiseChoices ?? [], participantId, comparison.left.target, comparison.right.target) === null,
  ) ?? null;
  const leftColumnName = activeComparison
    ? roomState.columns.find((column) => column.id === activeComparison.left.columnId)?.name ?? "Column"
    : "Column";
  const rightColumnName = activeComparison
    ? roomState.columns.find((column) => column.id === activeComparison.right.columnId)?.name ?? "Column"
    : "Column";
  const comparisonScope = activeComparison
    ? leftColumnName === rightColumnName ? leftColumnName : `${leftColumnName} vs ${rightColumnName}`
    : "Whole board";

  useEffect(() => {
    setPendingPairwiseKey(null);
  }, [roomState.version, setPendingPairwiseKey]);

  useEffect(() => {
    if (serverError) {
      setPendingPairwiseKey(null);
    }
  }, [serverError, setPendingPairwiseKey]);

  useEffect(() => {
    if (previousAnsweredCount.current !== null && answeredCount > previousAnsweredCount.current) {
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
    const sent = send({ type: "choose-pairwise", winner, loser });
    if (!sent) {
      setLocalError("Ranking choice not sent. Please try again once the room is connected.");
      return;
    }
    setPendingWinnerKey(voteTargetKey(winner));
    setPendingPairwiseKey(activeComparison.key);
  }

  if (comparisons.length === 0 || activeComparison === null) {
    if (isComplete) {
      return (
        <div className="pairwise-vote-board">
          <div className={`vote-budget-bar${progressPulse ? " vote-budget-bar--pulse" : ""}`} role="status" aria-live="polite">
            <span className="vote-budget-bar__label">Pairwise ranking:</span>
            <span className="vote-budget-bar__value">{answeredCount} of {comparisons.length} comparisons complete</span>
          </div>
          <section className="pairwise-comparison-card pairwise-comparison-card--complete" aria-label="Pairwise ranking complete">
            <div className="pairwise-comparison-card__header">
              <span className="vote-column__eyebrow">
                <Columns3 size={13} aria-hidden="true" />
                Ranking complete
              </span>
              <h3>All comparisons are complete</h3>
              <p>The facilitator can advance to review when the team is ready. Results are ranked by comparison wins.</p>
            </div>
            <ol className="pairwise-summary-list" aria-label="Completed pairwise choices">
              {comparisons.map((comparison) => {
                const choice = getPairwiseChoice(roomState.pairwiseChoices ?? [], participantId, comparison.left.target, comparison.right.target);
                const winnerLabel = choice && sameTarget(choice.winner, comparison.left.target) ? comparison.left.label : comparison.right.label;
                const loserLabel = choice && sameTarget(choice.winner, comparison.left.target) ? comparison.right.label : comparison.left.label;
                return (
                  <li key={comparison.key}>
                    <span>{winnerLabel}</span>
                    <small>ranked over {loserLabel}</small>
                  </li>
                );
              })}
            </ol>
          </section>
          <PairwiseProgressPanel progress={participantProgress} teamPercent={teamPercent} allComplete={allParticipantsComplete} currentParticipantId={participantId} />
          <PairwiseColumnBreakdown summaries={columnSummaries} totalPairs={comparisons.length} answeredPairs={answeredCount} />
        </div>
      );
    }
    return (
      <div className="empty-state">
        <div className="empty-state__icon empty-state__icon--vote" aria-hidden="true">Rank</div>
        <p className="empty-state__text">No pairwise comparisons yet.</p>
        <p className="empty-state__subtext">
          Pairwise ranking needs at least two decision targets. Groups and ungrouped cards are compared across the whole board.
        </p>
        <PairwiseProgressPanel progress={participantProgress} teamPercent={teamPercent} allComplete={allParticipantsComplete} currentParticipantId={participantId} />
        <PairwiseColumnBreakdown summaries={columnSummaries} totalPairs={comparisons.length} answeredPairs={answeredCount} />
      </div>
    );
  }

  const selectedChoice = getPairwiseChoice(roomState.pairwiseChoices ?? [], participantId, activeComparison.left.target, activeComparison.right.target);
  const isPending = pendingPairwiseKey === activeComparison.key;

  return (
    <div className="pairwise-vote-board">
      <div className={`vote-budget-bar${progressPulse ? " vote-budget-bar--pulse" : ""}`} role="status" aria-live="polite">
        <span className="vote-budget-bar__label">Pairwise ranking:</span>
        <span className="vote-budget-bar__value">{answeredCount} of {comparisons.length} comparisons complete</span>
        <span className="vote-budget-bar__remaining">({comparisonScope})</span>
      </div>
      {(localError || serverError) && (
        <div className="status-msg status-msg--error vote-error" role="alert">
          {localError ?? serverError}
        </div>
      )}
      <PairwiseProgressPanel progress={participantProgress} teamPercent={teamPercent} allComplete={allParticipantsComplete} currentParticipantId={participantId} />
      <section key={activeComparison.key} className="pairwise-comparison-card pairwise-comparison-card--enter" aria-label={`Pairwise comparison: ${comparisonScope}`}>
        <div className="pairwise-comparison-card__header">
          <span className="vote-column__eyebrow">
            <Columns3 size={13} aria-hidden="true" />
            {comparisonScope}
          </span>
          <h3>Which should rank higher?</h3>
          <p>Choose the stronger discussion target. Groups and ungrouped cards are ranked against every other target on the board.</p>
        </div>
        <div className="pairwise-options">
          <PairwiseOption
            roomState={roomState}
            participantId={participantId}
            send={send}
            target={activeComparison.left.target}
            label={activeComparison.left.label}
            columnName={leftColumnName}
            selected={selectedChoice ? sameTarget(selectedChoice.winner, activeComparison.left.target) : false}
            pending={isPending && pendingWinnerKey === voteTargetKey(activeComparison.left.target)}
            disabled={isPending}
            onChoose={() => choose(activeComparison.left.target, activeComparison.right.target)}
          />
          <span className="pairwise-options__divider" aria-hidden="true">or</span>
          <PairwiseOption
            roomState={roomState}
            participantId={participantId}
            send={send}
            target={activeComparison.right.target}
            label={activeComparison.right.label}
            columnName={rightColumnName}
            selected={selectedChoice ? sameTarget(selectedChoice.winner, activeComparison.right.target) : false}
            pending={isPending && pendingWinnerKey === voteTargetKey(activeComparison.right.target)}
            disabled={isPending}
            onChoose={() => choose(activeComparison.right.target, activeComparison.left.target)}
          />
        </div>
      </section>
      <PairwiseColumnBreakdown summaries={columnSummaries} totalPairs={comparisons.length} answeredPairs={answeredCount} />
    </div>
  );
}

function PairwiseProgressPanel({
  progress,
  teamPercent,
  allComplete,
  currentParticipantId,
}: {
  progress: Array<{
    participant: RoomState["participants"][number];
    answered: number;
    total: number;
    percent: number;
    complete: boolean;
  }>;
  teamPercent: number;
  allComplete: boolean;
  currentParticipantId: string;
}) {
  if (progress.length === 0) return null;

  return (
    <section className={`pairwise-progress${allComplete ? " pairwise-progress--complete" : ""}`} aria-label="Participant ranking progress">
      <div className="pairwise-progress__header">
        <div>
          <strong>Ranking progress</strong>
          <span>{allComplete ? "Everyone has ranked" : "Visible to everyone in the room"}</span>
        </div>
        <div key={teamPercent} className={`pairwise-progress__meter${allComplete ? " pairwise-progress__meter--complete" : ""}`} aria-label={`${teamPercent}% of participant ranking complete`}>
          <span>{teamPercent}%</span>
        </div>
      </div>
      <ul className="pairwise-progress__list">
        {progress.map((item) => (
          <li key={item.participant.id} className={`pairwise-progress__item${item.complete ? " pairwise-progress__item--complete" : ""}`}>
            <span className="pairwise-progress__status" aria-hidden="true" />
            <span className="pairwise-progress__name">{item.participant.displayName}</span>
            {item.participant.id === currentParticipantId && <span className="pairwise-progress__self">You</span>}
            <span className="pairwise-progress__count">
              {item.answered}/{item.total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PairwiseColumnBreakdown({
  summaries,
  totalPairs,
  answeredPairs,
}: {
  summaries: Array<{ id: string; name: string; targetCount: number }>;
  totalPairs: number;
  answeredPairs: number;
}) {
  return (
    <section className="pairwise-breakdown" aria-label="Pairwise comparison coverage">
      <div className="pairwise-breakdown__header">
        <strong>Comparison coverage</strong>
        <span>{answeredPairs}/{totalPairs} global pairs. Groups and ungrouped cards are compared across the whole board.</span>
      </div>
      <ul className="pairwise-breakdown__list">
        {summaries.map((summary) => (
          <li key={summary.id} className={summary.targetCount === 0 ? "pairwise-breakdown__item pairwise-breakdown__item--muted" : "pairwise-breakdown__item"}>
            <span>{summary.name}</span>
            <small>
              {summary.targetCount} target{summary.targetCount === 1 ? "" : "s"}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PairwiseOption({
  roomState,
  participantId,
  send,
  target,
  label,
  columnName,
  selected,
  pending,
  disabled,
  onChoose,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  target: VoteTarget;
  label: string;
  columnName: string;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const groupItems = target.type === "group"
    ? getGroupedItems(roomState.items, target.id).sort((a, b) => a.order - b.order)
    : [];
  const item = target.type === "item" ? roomState.items.find((candidate) => candidate.id === target.id) ?? null : null;
  const group = item?.groupId ? roomState.groups.find((candidate) => candidate.id === item.groupId) ?? null : null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose();
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`pairwise-option${selected ? " pairwise-option--selected" : ""}${pending ? " pairwise-option--pending" : ""}`}
      aria-disabled={disabled}
      aria-pressed={selected}
      onClick={() => {
        if (!disabled) onChoose();
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="pairwise-option__title">{label}</span>
      <small className="pairwise-option__kind">{columnName}</small>
      <ReactionBar roomState={roomState} target={target} participantId={participantId} send={send} label={label} compact stopPropagation />
      {target.type === "group" ? (
        <div className="pairwise-option__cards" aria-label={`Cards in ${label}`}>
          {groupItems.length > 0 ? (
            <ul>
              {groupItems.map((item) => (
                <li key={item.id}>
                  <span>{item.text}</span>
                  <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} compact stopPropagation />
                </li>
              ))}
            </ul>
          ) : (
            <small>No cards in this group.</small>
          )}
        </div>
      ) : (
        <small className="pairwise-option__kind">{group ? `Card in ${group.name}` : "Ungrouped card"}</small>
      )}
      <strong>{pending ? "Saving..." : selected ? "Selected" : "Choose this"}</strong>
    </div>
  );
}

function sameTarget(left: VoteTarget, right: VoteTarget): boolean {
  return left.type === right.type && left.id === right.id;
}
