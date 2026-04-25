import { useState, useCallback } from "react";
import type { RoomState, RetroItem, Group } from "../domain";
import { getUngroupedItems, getGroupedItems, sanitizeGroupName, isValidGroupName } from "../domain";

interface OrganiseBoardProps {
  roomState: RoomState;
  send: (message: unknown) => void;
}

export function OrganiseBoard({ roomState, send }: OrganiseBoardProps) {
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);

  const isOrganise = roomState.phase === "organise";

  const sortedGroups = [...roomState.groups].sort((a, b) => a.order - b.order);
  const ungrouped = getUngroupedItems(roomState.items);
  const movingItem = movingItemId ? roomState.items.find((i) => i.id === movingItemId) : null;

  function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupError(null);
    if (!isValidGroupName(newGroupName)) {
      setGroupError("Group name cannot be empty.");
      return;
    }
    send({ type: "create-group", name: sanitizeGroupName(newGroupName) });
    setNewGroupName("");
  }

  const handleReorderItems = useCallback(
    (items: RetroItem[], fromIdx: number, toIdx: number) => {
      const reordered = [...items];
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) return;
      reordered.splice(toIdx, 0, moved);
      send({ type: "reorder-items", itemIds: reordered.map((i) => i.id) });
    },
    [send],
  );

  const handleReorderGroups = useCallback(
    (fromIdx: number, toIdx: number) => {
      const reordered = [...sortedGroups];
      const [moved] = reordered.splice(fromIdx, 1);
      if (!moved) return;
      reordered.splice(toIdx, 0, moved);
      send({ type: "reorder-groups", groupIds: reordered.map((g) => g.id) });
    },
    [send, sortedGroups],
  );

  function handleMoveToGroup(itemId: string, targetGroupId: string | null, targetIndex: number) {
    setMovingItemId(null);
    send({ type: "move-item-to-group", itemId, groupId: targetGroupId, index: targetIndex });
  }

  const allItemsEmpty = roomState.items.length === 0;

  return (
    <div>
      {isOrganise && (
        <div style={{ marginBottom: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <form onSubmit={handleCreateGroup} className="input-row" style={{ flex: 1 }}>
            <input
              type="text"
              className="input"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={100}
              placeholder="New group name…"
            />
            <button type="submit" className="btn btn--secondary btn--sm">Create Group</button>
          </form>
          {groupError && <span className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }}>{groupError}</span>}
        </div>
      )}

      {movingItemId && (
        <MoveTargetPicker
          groups={sortedGroups}
          movingItemText={movingItem?.text ?? null}
          onCancel={() => setMovingItemId(null)}
          onSelect={(groupId, index) => handleMoveToGroup(movingItemId, groupId, index)}
        />
      )}

      {allItemsEmpty ? (
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__text">No items to organise.</p>
        </div>
      ) : (
        <>
          {/* Ordered groups */}
          {sortedGroups.map((group, groupIdx) => {
            const groupItems = getGroupedItems(roomState.items, group.id);
            return (
              <GroupSection
                key={group.id}
                group={group}
                items={groupItems}
                groupIndex={groupIdx}
                totalGroups={sortedGroups.length}
                isOrganise={isOrganise}
                onReorderItems={handleReorderItems}
                onReorderGroups={handleReorderGroups}
                onMoveItem={(itemId) => setMovingItemId(itemId)}
              />
            );
          })}

          {/* Ungrouped items */}
          {ungrouped.length > 0 && (
            <div className="ungrouped-section">
              <div className="section-header">
                <span className="section-title">Ungrouped</span>
              </div>
              <ul className="item-list">
                {ungrouped.map((item, idx) => (
                  <li key={item.id} className="item-row">
                    <span className="item-row__text">{item.text}</span>
                    {isOrganise && (
                      <span className="item-row__actions">
                        <button
                          className="reorder-btn"
                          disabled={idx === 0}
                          onClick={() => handleReorderItems(ungrouped, idx, idx - 1)}
                          title="Move up"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          className="reorder-btn"
                          disabled={idx === ungrouped.length - 1}
                          onClick={() => handleReorderItems(ungrouped, idx, idx + 1)}
                          title="Move down"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button className="btn btn--secondary btn--sm" onClick={() => setMovingItemId(item.id)} title="Move to group">
                          →
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface GroupSectionProps {
  group: Group;
  items: RetroItem[];
  groupIndex: number;
  totalGroups: number;
  isOrganise: boolean;
  onReorderItems: (items: RetroItem[], fromIdx: number, toIdx: number) => void;
  onReorderGroups: (fromIdx: number, toIdx: number) => void;
  onMoveItem: (itemId: string) => void;
}

function GroupSection({ group, items, groupIndex, totalGroups, isOrganise, onReorderItems, onReorderGroups, onMoveItem }: GroupSectionProps) {
  return (
    <div className="group-panel">
      <div className="group-panel__header">
        <h4 className="group-panel__title">{group.name}</h4>
        {isOrganise && (
          <span className="group-panel__controls">
            <button
              className="reorder-btn"
              disabled={groupIndex === 0}
              onClick={() => onReorderGroups(groupIndex, groupIndex - 1)}
              title="Move group up"
              aria-label="Move group up"
            >
              ↑
            </button>
            <button
              className="reorder-btn"
              disabled={groupIndex === totalGroups - 1}
              onClick={() => onReorderGroups(groupIndex, groupIndex + 1)}
              title="Move group down"
              aria-label="Move group down"
            >
              ↓
            </button>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>No items in this group.</p>
      ) : (
        <ul className="item-list">
          {items.map((item, idx) => (
            <li key={item.id} className="item-row">
              <span className="item-row__text">{item.text}</span>
              {isOrganise && (
                <span className="item-row__actions">
                  <button
                    className="reorder-btn"
                    disabled={idx === 0}
                    onClick={() => onReorderItems(items, idx, idx - 1)}
                    title="Move up"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="reorder-btn"
                    disabled={idx === items.length - 1}
                    onClick={() => onReorderItems(items, idx, idx + 1)}
                    title="Move down"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button className="btn btn--secondary btn--sm" onClick={() => onMoveItem(item.id)} title="Move to group">
                    →
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface MoveTargetPickerProps {
  groups: Group[];
  movingItemText: string | null;
  onCancel: () => void;
  onSelect: (groupId: string | null, index: number) => void;
}

function MoveTargetPicker({ groups, movingItemText, onCancel, onSelect }: MoveTargetPickerProps) {
  return (
    <div className="move-picker" role="dialog" aria-label="Move item to group" aria-describedby={movingItemText ? "move-item-preview" : undefined}>
      <p className="move-picker__title">Move item to:</p>
      {movingItemText && (
        <p id="move-item-preview" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>
          Moving: <em>"{movingItemText}"</em>
        </p>
      )}
      <div className="move-picker__options" role="group" aria-label="Destination options">
        <button className="btn btn--secondary btn--sm" onClick={() => onSelect(null, 0)} aria-label="Move to Ungrouped">Ungrouped</button>
        {groups.map((g) => (
          <button key={g.id} className="btn btn--secondary btn--sm" onClick={() => onSelect(g.id, 0)} aria-label={`Move to group ${g.name}`}>
            {g.name}
          </button>
        ))}
        <button className="btn btn--danger btn--sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
