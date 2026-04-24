import type { RoomState } from "../domain";
import { getUngroupedItems, getGroupedItems, getVotesForItem } from "../domain";

interface ReviewBoardProps {
  roomState: RoomState;
}

export function ReviewBoard({ roomState }: ReviewBoardProps) {
  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const ungrouped = getUngroupedItems(roomState.items);
  const hasItems = roomState.items.length > 0;

  if (!hasItems) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center", color: "#888" }}>
        <p>No items were added during this retro.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1rem", padding: "0.5rem 0.75rem", border: "1px solid #ddd", borderRadius: 4, background: "#f5f5f5" }}>
        <strong>Review Phase</strong>
        <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
          — Results are read-only
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
                {groupItems.map((item) => (
                  <ReviewItemRow key={item.id} item={item} votes={roomState.votes} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px dashed #ccc", borderRadius: 4 }}>
          <h4 style={{ margin: "0 0 0.5rem 0" }}>Ungrouped</h4>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {ungrouped.map((item) => (
              <ReviewItemRow key={item.id} item={item} votes={roomState.votes} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewItemRow({ item, votes }: { item: { id: string; text: string }; votes: RoomState["votes"] }) {
  const totalVotes = getVotesForItem(votes, item.id);

  return (
    <li style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ flex: 1 }}>{item.text}</span>
      <span style={{
        fontSize: "0.85rem",
        color: totalVotes > 0 ? "#333" : "#aaa",
        marginLeft: "1rem",
        minWidth: "3.5rem",
        textAlign: "right",
        fontWeight: totalVotes > 0 ? 600 : 400,
      }}>
        {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
      </span>
    </li>
  );
}
