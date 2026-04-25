import { useState, useCallback, useRef, useEffect } from "react";
import type { RoomState } from "../domain";
import { getUngroupedItems, getGroupedItems, getVotesForItem, getRemainingBudget, getVotesByParticipant } from "../domain";

interface VoteBoardProps {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => void;
}

export function VoteBoard({ roomState, participantId, send }: VoteBoardProps) {
  const [pendingCastCount, setPendingCastCount] = useState(0);
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(new Set());

  const serverRemaining = getRemainingBudget(roomState.votes, participantId, roomState.voteBudget);
  const effectiveRemaining = serverRemaining - pendingCastCount;
  const used = getVotesByParticipant(roomState.votes, participantId);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);

  const handleVote = useCallback(
    (itemId: string) => {
      if (effectiveRemaining <= 0) return;
      setPendingCastCount((c) => c + 1);
      send({ type: "cast-vote", itemId, count: 1 });
    },
    [effectiveRemaining, send],
  );

  const handleRemoveVote = useCallback(
    (itemId: string) => {
      if (pendingRemoves.has(itemId)) return;
      setPendingRemoves((prev) => new Set(prev).add(itemId));
      send({ type: "remove-vote", itemId });
    },
    [pendingRemoves, send],
  );

  const serverVersionRef = useRef(roomState.version);

  useEffect(() => {
    if (serverVersionRef.current !== roomState.version) {
      serverVersionRef.current = roomState.version;
      setPendingCastCount(0);
      setPendingRemoves(new Set());
    }
  }, [roomState.version]);

  function getParticipantVotesForItem(itemId: string): number {
    return roomState.votes
      .filter((v) => v.participantId === participantId && v.itemId === itemId)
      .reduce((sum, v) => sum + v.count, 0);
  }

  function renderItem(item: { id: string; text: string }) {
    const totalVotes = getVotesForItem(roomState.votes, item.id);
    const myVotes = getParticipantVotesForItem(item.id);

    return (
      <li key={item.id} className="item-row">
        <span className="item-row__text">{item.text}</span>
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
            onClick={() => handleRemoveVote(item.id)}
            disabled={myVotes === 0 || pendingRemoves.has(item.id)}
            title="Remove one of your votes"
            aria-label="Remove one of your votes"
          >
            −
          </button>
          <button
            className="reorder-btn"
            onClick={() => handleVote(item.id)}
            disabled={effectiveRemaining <= 0}
            title="Add a vote"
            aria-label="Add a vote"
          >
            +
          </button>
        </span>
      </li>
    );
  }

  return (
    <div>
      <div className="vote-budget-bar" role="status" aria-live="polite">
        <span className="vote-budget-bar__label">Your votes:</span>
        <span className="vote-budget-bar__value">{used} used / {roomState.voteBudget} total</span>
        <span className={`vote-budget-bar__remaining${effectiveRemaining === 0 ? " vote-budget-bar__remaining--zero" : ""}`}>
          ({effectiveRemaining} remaining)
        </span>
      </div>

      {sortedGroups.map((group) => {
        const groupItems = getGroupedItems(roomState.items, group.id);
        return (
          <div key={group.id} className="group-panel">
            <div className="group-panel__header">
              <h4 className="group-panel__title">{group.name}</h4>
            </div>
            {groupItems.length === 0 ? (
              <p className="text-muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>No items.</p>
            ) : (
              <ul className="item-list">
                {groupItems.map((item) => renderItem(item))}
              </ul>
            )}
          </div>
        );
      })}

      {(() => {
        const ungrouped = getUngroupedItems(roomState.items);
        if (ungrouped.length === 0) return null;
        return (
          <div className="ungrouped-section">
            <div className="section-header">
              <span className="section-title">Ungrouped</span>
            </div>
            <ul className="item-list">
              {ungrouped.map((item) => renderItem(item))}
            </ul>
          </div>
        );
      })()}

      {roomState.items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">🗳️</div>
          <p className="empty-state__text">No items to vote on.</p>
        </div>
      )}
    </div>
  );
}
