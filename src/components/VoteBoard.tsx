import { useState, useCallback, useRef, useEffect } from "react";
import type { RoomState } from "../domain";
import { getGroupedItems, getVotesForGroup, getRemainingBudget, getVotesByParticipant, getVotesForTarget, groupVoteTarget } from "../domain";

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
  const [voteError, setVoteError] = useState<string | null>(null);

  const serverRemaining = getRemainingBudget(roomState.votes, participantId, roomState.voteBudget);
  const effectiveRemaining = serverRemaining - pendingCastCount;
  const used = getVotesByParticipant(roomState.votes, participantId);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);

  const handleVote = useCallback(
    (groupId: string) => {
      if (effectiveRemaining <= 0) return;
      setVoteError(null);
      clearServerError?.();
      if (!send({ type: "cast-vote", groupId, count: 1 })) {
        setVoteError("Vote not sent. Please try again once the room is connected.");
        return;
      }
      setPendingCastCount((c) => c + 1);
    },
    [clearServerError, effectiveRemaining, send],
  );

  const handleRemoveVote = useCallback(
    (groupId: string) => {
      if (pendingRemoves.has(groupId)) return;
      setVoteError(null);
      clearServerError?.();
      if (!send({ type: "remove-vote", groupId })) {
        setVoteError("Vote not removed. Please try again once the room is connected.");
        return;
      }
      setPendingRemoves((prev) => new Set(prev).add(groupId));
    },
    [clearServerError, pendingRemoves, send],
  );

  const serverVersionRef = useRef(roomState.version);

  useEffect(() => {
    if (serverVersionRef.current !== roomState.version) {
      serverVersionRef.current = roomState.version;
      setPendingCastCount(0);
      setPendingRemoves(new Set());
      setVoteError(null);
    }
  }, [roomState.version]);

  function getParticipantVotesForGroup(groupId: string): number {
    return roomState.votes
      .filter((v) => v.participantId === participantId)
      .filter((v) => getVotesForTarget([v], groupVoteTarget(groupId)) > 0)
      .reduce((sum, v) => sum + v.count, 0);
  }

  function renderGroup(group: { id: string; name: string }) {
    const totalVotes = getVotesForGroup(roomState.votes, group.id);
    const myVotes = getParticipantVotesForGroup(group.id);
    const groupItems = getGroupedItems(roomState.items, group.id);
    return (
      <div key={group.id} className="group-panel" data-vote-group-id={group.id}>
        <div className="group-panel__header">
          <h4 className="group-panel__title">{group.name}</h4>
          <span className="item-row__actions" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", minWidth: "3rem", textAlign: "right" }}>
              {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
            </span>
            {myVotes > 0 && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--accent)", marginLeft: "var(--space-1)" }}>
                (you: {myVotes})
              </span>
            )}
            <button
              className="reorder-btn"
              onClick={() => handleRemoveVote(group.id)}
              disabled={myVotes === 0 || pendingRemoves.has(group.id)}
              title={`Remove one of your votes from ${group.name}`}
              aria-label={`Remove one of your votes from ${group.name}`}
            >
              −
            </button>
            <button
              className="reorder-btn"
              onClick={() => handleVote(group.id)}
              disabled={effectiveRemaining <= 0}
              title={`Add a vote to ${group.name}`}
              aria-label={`Add a vote to ${group.name}`}
            >
              +
            </button>
          </span>
        </div>
        {groupItems.length === 0 ? (
          <p className="text-muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>No items.</p>
        ) : (
          <ul className="item-list" aria-label={`Items in ${group.name}`}>
            {groupItems.map((item) => (
              <li key={item.id} className="item-row">
                <span className="item-row__text">{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const hasGroups = sortedGroups.length > 0;

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
        <div className="status-msg status-msg--error" role="alert" style={{ marginBottom: "var(--space-3)" }}>
          {voteError ?? serverError}
        </div>
      )}

      {hasGroups ? (
        sortedGroups.map((group) => renderGroup(group))
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon">🗳️</div>
          <p className="empty-state__text">No groups to vote on.</p>
          <p className="text-muted" style={{ margin: 0 }}>
            Create groups during organise before voting, or advance when there is nothing to vote on.
          </p>
        </div>
      )}
    </div>
  );
}
