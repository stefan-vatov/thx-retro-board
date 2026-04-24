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
    send({ type: "move-item-to-group", itemId, groupId: targetGroupId, index: targetIndex });
    setMovingItemId(null);
  }

  const allItemsEmpty = roomState.items.length === 0;

  return (
    <div>
      {isOrganise && (
        <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
          <form onSubmit={handleCreateGroup} style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={100}
              placeholder="New group name..."
              style={{ padding: "0.4rem", width: 200 }}
            />
            <button type="submit">Create Group</button>
          </form>
          {groupError && <span style={{ color: "red", fontSize: "0.85rem" }}>{groupError}</span>}
        </div>
      )}

      {movingItemId && (
        <MoveTargetPicker
          groups={sortedGroups}
          onCancel={() => setMovingItemId(null)}
          onSelect={(groupId, index) => handleMoveToGroup(movingItemId, groupId, index)}
        />
      )}

      {allItemsEmpty ? (
        <p style={{ color: "#888" }}>No items to organise.</p>
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
            <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px dashed #ccc", borderRadius: 4 }}>
              <h4 style={{ margin: "0 0 0.5rem 0" }}>Ungrouped</h4>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {ungrouped.map((item, idx) => (
                  <li key={item.id} style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{item.text}</span>
                    {isOrganise && (
                      <span style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          disabled={idx === 0}
                          onClick={() => handleReorderItems(ungrouped, idx, idx - 1)}
                          title="Move up"
                          style={{ padding: "0 0.4rem" }}
                        >
                          ↑
                        </button>
                        <button
                          disabled={idx === ungrouped.length - 1}
                          onClick={() => handleReorderItems(ungrouped, idx, idx + 1)}
                          title="Move down"
                          style={{ padding: "0 0.4rem" }}
                        >
                          ↓
                        </button>
                        <button onClick={() => setMovingItemId(item.id)} title="Move to group">
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
    <div style={{ marginTop: "1rem", padding: "0.75rem", border: "1px solid #ddd", borderRadius: 4, background: "#fafafa" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h4 style={{ margin: 0 }}>{group.name}</h4>
        {isOrganise && (
          <span style={{ display: "flex", gap: "0.25rem" }}>
            <button
              disabled={groupIndex === 0}
              onClick={() => onReorderGroups(groupIndex, groupIndex - 1)}
              title="Move group up"
              style={{ padding: "0 0.4rem" }}
            >
              ↑
            </button>
            <button
              disabled={groupIndex === totalGroups - 1}
              onClick={() => onReorderGroups(groupIndex, groupIndex + 1)}
              title="Move group down"
              style={{ padding: "0 0.4rem" }}
            >
              ↓
            </button>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ color: "#aaa", fontSize: "0.85rem", margin: 0 }}>No items in this group.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((item, idx) => (
            <li key={item.id} style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{item.text}</span>
              {isOrganise && (
                <span style={{ display: "flex", gap: "0.25rem" }}>
                  <button
                    disabled={idx === 0}
                    onClick={() => onReorderItems(items, idx, idx - 1)}
                    title="Move up"
                    style={{ padding: "0 0.4rem" }}
                  >
                    ↑
                  </button>
                  <button
                    disabled={idx === items.length - 1}
                    onClick={() => onReorderItems(items, idx, idx + 1)}
                    title="Move down"
                    style={{ padding: "0 0.4rem" }}
                  >
                    ↓
                  </button>
                  <button onClick={() => onMoveItem(item.id)} title="Move to group">
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
  onCancel: () => void;
  onSelect: (groupId: string | null, index: number) => void;
}

function MoveTargetPicker({ groups, onCancel, onSelect }: MoveTargetPickerProps) {
  return (
    <div style={{ marginBottom: "1rem", padding: "0.75rem", border: "1px solid #4a90d9", borderRadius: 4, background: "#f0f7ff" }}>
      <strong>Move item to:</strong>
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={() => onSelect(null, 0)}>Ungrouped</button>
        {groups.map((g) => (
          <button key={g.id} onClick={() => onSelect(g.id, 0)}>
            {g.name}
          </button>
        ))}
        <button onClick={onCancel} style={{ color: "red" }}>Cancel</button>
      </div>
    </div>
  );
}
