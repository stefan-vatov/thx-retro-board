import { useState, useCallback, useRef, useEffect } from "react";
import { Effect } from "effect";
import { Columns3 } from "lucide-react";
import type { RoomState, VoteTarget } from "../domain";
import {
  getGroupedItems,
  getRemainingBudget,
  getUngroupedItems,
  getVotesByParticipant,
  getVotesForGroupEffect,
  getVotesForTarget,
  getVotesForUngroupedItemEffect,
  groupVoteTarget,
  itemVoteTarget,
  voteTargetKey,
} from "../domain";
import { ReactionBar } from "./Reactions";
import { PairwiseVoteBoard } from "./PairwiseVoteBoard";

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
    const totalVotes = Effect.runSync(getVotesForGroupEffect(roomState.votes, group.id));
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
    const totalVotes = Effect.runSync(getVotesForUngroupedItemEffect(roomState.votes, item.id));
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
      ...sortedGroups.filter((group) => group.columnId === column.id).map((group) => Effect.runSync(getVotesForGroupEffect(roomState.votes, group.id))),
      ...sortedUngroupedItems.filter((item) => item.columnId === column.id).map((item) => Effect.runSync(getVotesForUngroupedItemEffect(roomState.votes, item.id))),
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
