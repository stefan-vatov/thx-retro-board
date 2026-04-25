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
      <div className="glass-panel" style={{ textAlign: "center" }}>
        <div className="review-banner" role="status" aria-live="polite" style={{ justifyContent: "center", marginBottom: "var(--space-4)" }}>
          <span>📋</span>
          <span>Review Phase — Results are read-only</span>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">No items were added during this retro.</p>
        </div>
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
              <span className="review-section-count">{groupItems.length} item{groupItems.length !== 1 ? "s" : ""}</span>
            </div>
            {groupItems.length === 0 ? (
              <p className="text-muted review-empty-group">No items in this group.</p>
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
            <span className="review-section-count">{ungrouped.length} item{ungrouped.length !== 1 ? "s" : ""}</span>
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
  const isEmphasized = totalVotes > 0;

  return (
    <li className="item-row review-item-row">
      <span className="item-row__text">{item.text}</span>
      <span className={`review-vote-count${isEmphasized ? " review-vote-count--emphasized" : " review-vote-count--zero"}`}>
        {totalVotes}
        <span className="review-vote-label"> vote{totalVotes !== 1 ? "s" : ""}</span>
      </span>
    </li>
  );
}
