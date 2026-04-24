import type { RoomState } from "../domain";
import { getUngroupedItems, getGroupedItems, getVotesForItem, getRemainingBudget, getVotesByParticipant } from "../domain";

interface VoteBoardProps {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => void;
}

export function VoteBoard({ roomState, participantId, send }: VoteBoardProps) {
  const remaining = getRemainingBudget(roomState.votes, participantId, roomState.voteBudget);
  const used = getVotesByParticipant(roomState.votes, participantId);
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);

  function handleVote(itemId: string) {
    send({ type: "cast-vote", itemId, count: 1 });
  }

  function handleRemoveVote(itemId: string) {
    send({ type: "remove-vote", itemId });
  }

  function getParticipantVotesForItem(itemId: string): number {
    return roomState.votes
      .filter((v) => v.participantId === participantId && v.itemId === itemId)
      .reduce((sum, v) => sum + v.count, 0);
  }

  function renderItem(item: { id: string; text: string }) {
    const totalVotes = getVotesForItem(roomState.votes, item.id);
    const myVotes = getParticipantVotesForItem(item.id);

    return (
      <li key={item.id} style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ flex: 1 }}>{item.text}</span>
        <span style={{ display: "flex", gap: "0.25rem", alignItems: "center", marginLeft: "1rem" }}>
          <span style={{ fontSize: "0.85rem", color: "#666", minWidth: "3rem", textAlign: "right" }}>
            {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
          </span>
          {myVotes > 0 && (
            <span style={{ fontSize: "0.75rem", color: "#4a90d9", marginLeft: "0.25rem" }}>
              (you: {myVotes})
            </span>
          )}
          <button
            onClick={() => handleRemoveVote(item.id)}
            disabled={myVotes === 0}
            title="Remove one of your votes"
            style={{ padding: "0 0.4rem", fontSize: "0.85rem" }}
          >
            −
          </button>
          <button
            onClick={() => handleVote(item.id)}
            disabled={remaining <= 0}
            title="Add a vote"
            style={{ padding: "0 0.4rem", fontSize: "0.85rem" }}
          >
            +
          </button>
        </span>
      </li>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", border: "1px solid #ddd", borderRadius: 4, background: "#f5f5f5" }}>
        <strong>Your votes:</strong> {used} used / {roomState.voteBudget} total
        <span style={{ marginLeft: "1rem", color: remaining === 0 ? "#c00" : "#555" }}>
          ({remaining} remaining)
        </span>
      </div>

      {sortedGroups.map((group) => {
        const groupItems = getGroupedItems(roomState.items, group.id);
        return (
          <div key={group.id} style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ddd", borderRadius: 4, background: "#fafafa" }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>{group.name}</h4>
            {groupItems.length === 0 ? (
              <p style={{ color: "#aaa", fontSize: "0.85rem", margin: 0 }}>No items.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
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
          <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px dashed #ccc", borderRadius: 4 }}>
            <h4 style={{ margin: "0 0 0.5rem 0" }}>Ungrouped</h4>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {ungrouped.map((item) => renderItem(item))}
            </ul>
          </div>
        );
      })()}

      {roomState.items.length === 0 && (
        <p style={{ color: "#888" }}>No items to vote on.</p>
      )}
    </div>
  );
}
