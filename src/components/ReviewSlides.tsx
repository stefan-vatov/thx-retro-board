import type { RoomState } from "../domain";
import { getGroupedItems, groupVoteTarget, itemVoteTarget } from "../domain";
import { ReactionBar } from "./Reactions";

export function GroupReviewSlide({
  roomState,
  participantId,
  send,
  group,
  columnName,
  totalVotes,
  voteLabel,
  targetKey,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  group: { id: string; name: string };
  columnName: string;
  totalVotes: number;
  voteLabel: string;
  targetKey: string;
}) {
  const groupItems = getGroupedItems(roomState.items, group.id);
  return (
    <article
      className="group-panel review-slide"
      data-review-target-key={targetKey}
      data-review-group-id={group.id}
      aria-label={`Review slide for ${group.name}`}
    >
      <div className="review-target-summary">
        <div className="group-panel__header review-slide__header">
          <div>
            <p className="review-slide__eyebrow">Group result</p>
            <h4 className="group-panel__title review-slide__title">
              {group.name}
            </h4>
          </div>
          <ReviewVoteTotal totalVotes={totalVotes} voteLabel={voteLabel} />
        </div>
        <div className="review-slide__meta">
          <span className="review-section-count">{columnName}</span>
          <span className="review-section-count">
            {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
          </span>
        </div>
        <ReactionBar
          roomState={roomState}
          target={groupVoteTarget(group.id)}
          participantId={participantId}
          send={send}
          label={group.name}
        />
      </div>
      {groupItems.length === 0 ? (
        <p className="text-muted review-empty-group">No items in this group.</p>
      ) : (
        <ul className="item-list" aria-label={`Items in ${group.name}`}>
          {groupItems.map((item) => (
            <ReviewItemRow
              key={item.id}
              roomState={roomState}
              participantId={participantId}
              send={send}
              item={item}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

export function ItemReviewSlide({
  roomState,
  participantId,
  send,
  item,
  columnName,
  groupName,
  totalVotes,
  voteLabel,
  targetKey,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  item: { id: string; text: string };
  columnName: string;
  groupName: string | null;
  totalVotes: number;
  voteLabel: string;
  targetKey: string;
}) {
  return (
    <article
      className="group-panel review-slide"
      data-review-target-key={targetKey}
      data-review-item-id={item.id}
      aria-label={`Review slide for ${item.text}`}
    >
      <div className="review-target-summary">
        <div className="group-panel__header review-slide__header">
          <div>
            <p className="review-slide__eyebrow">Item result</p>
            <h4 className="group-panel__title review-slide__title">
              {item.text}
            </h4>
          </div>
          <ReviewVoteTotal totalVotes={totalVotes} voteLabel={voteLabel} />
        </div>
        <div className="review-slide__meta">
          <span className="review-section-count">{columnName}</span>
          <span className="review-section-count">
            {groupName ? `Grouped in ${groupName}` : "Ungrouped item"}
          </span>
        </div>
        <ReactionBar
          roomState={roomState}
          target={itemVoteTarget(item.id)}
          participantId={participantId}
          send={send}
          label={item.text}
        />
      </div>
      <p className="text-muted review-empty-group">
        {groupName
          ? `This card was grouped under “${groupName}” and ranked as an individual card.`
          : "This item stayed ungrouped and was reviewed as its own vote target."}
      </p>
    </article>
  );
}

function ReviewVoteTotal({
  totalVotes,
  voteLabel,
}: {
  totalVotes: number;
  voteLabel: string;
}) {
  const label = `${voteLabel}${totalVotes !== 1 ? "s" : ""}`;
  return (
    <div
      className={`review-slide__votes${totalVotes > 0 ? " review-slide__votes--emphasized" : ""}`}
      aria-label={`${totalVotes} ${label}`}
    >
      <span className="review-slide__vote-number">{totalVotes}</span>
      <span className="review-slide__vote-label">{label}</span>
    </div>
  );
}

function ReviewItemRow({
  roomState,
  participantId,
  send,
  item,
}: {
  roomState: RoomState;
  participantId: string;
  send: (message: unknown) => boolean;
  item: { id: string; text: string };
}) {
  return (
    <li className="item-row review-item-row">
      <span className="item-row__text">{item.text}</span>
      <ReactionBar
        roomState={roomState}
        target={itemVoteTarget(item.id)}
        participantId={participantId}
        send={send}
        label={item.text}
        compact
      />
    </li>
  );
}
