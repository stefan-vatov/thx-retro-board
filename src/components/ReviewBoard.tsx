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
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <p className="empty-state__text">No items were added during this retro.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="review-banner" role="status" aria-live="polite">
        <span>📋</span>
        <span>Review Phase — Results are read-only</span>
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
                {groupItems.map((item) => (
                  <ReviewItemRow key={item.id} item={item} votes={roomState.votes} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div className="ungrouped-section">
          <div className="section-header">
            <span className="section-title">Ungrouped</span>
          </div>
          <ul className="item-list">
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
    <li className="item-row">
      <span className="item-row__text">{item.text}</span>
      <span style={{
        fontSize: "var(--text-sm)",
        color: totalVotes > 0 ? "var(--text-primary)" : "var(--text-muted)",
        marginLeft: "var(--space-3)",
        minWidth: "3.5rem",
        textAlign: "right",
        fontWeight: totalVotes > 0 ? "var(--weight-semibold)" : "var(--weight-normal)",
      }}>
        {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
      </span>
    </li>
  );
}
