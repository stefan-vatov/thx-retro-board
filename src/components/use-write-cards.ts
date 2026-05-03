import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  addItemEffect,
  deleteItemEffect,
  editItemEffect,
  getRoomStateEffect,
  runApiEffect,
} from "../api";
import type { RetroItem, RoomState } from "../domain";
import { isValidItemText, sanitizeItemText } from "../domain";
import { getSortedColumns } from "./room-columns";
import { refreshRoomStateAfterMutationEffect } from "./write-cards-effect";

type UseWriteCardsArgs = {
  roomId: string | undefined;
  roomState: RoomState | null;
  participantId: string;
  connectionToken: string | undefined;
  setLocalRoomState: (state: RoomState | null) => void;
};

export function useWriteCards({
  roomId,
  roomState,
  participantId,
  connectionToken,
  setLocalRoomState,
}: UseWriteCardsArgs) {
  const [columnInputs, setColumnInputs] = useState<Record<string, string>>({});
  const [columnErrors, setColumnErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [pendingColumnId, setPendingColumnId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const columnInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>(
    {},
  );
  const restoreColumnFocusRef = useRef<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState("");
  const sortedRoomColumns = roomState ? getSortedColumns(roomState) : [];

  function restoreColumnInputFocus(columnId: string) {
    const focusInput = () => {
      const target = columnInputRefs.current[columnId];
      const active = document.activeElement;
      const activeTag = active?.tagName.toLowerCase();
      const activeIsEditable =
        activeTag === "input" ||
        activeTag === "textarea" ||
        activeTag === "select" ||
        active?.getAttribute("contenteditable") === "true";
      if (!target || (activeIsEditable && active !== target)) return;
      target.focus();
    };
    window.requestAnimationFrame(focusInput);
    window.setTimeout(focusInput, 50);
    window.setTimeout(focusInput, 150);
  }

  function handleColumnInputChange(columnId: string, value: string) {
    setColumnInputs((current) => ({ ...current, [columnId]: value }));
    setColumnErrors((current) => ({ ...current, [columnId]: undefined }));
  }

  async function handleAddItem(event: React.FormEvent, columnId: string) {
    event.preventDefault();
    if (!roomId || pendingColumnId) return;
    const rawText = columnInputs[columnId] ?? "";
    setColumnErrors((current) => ({ ...current, [columnId]: undefined }));
    if (!isValidItemText(rawText)) {
      setColumnErrors((current) => ({
        ...current,
        [columnId]: "Card text cannot be blank.",
      }));
      return;
    }
    if (!sortedRoomColumns.some((column) => column.id === columnId)) {
      setColumnErrors((current) => ({
        ...current,
        [columnId]: "Column not found.",
      }));
      return;
    }
    const nextText = sanitizeItemText(rawText);
    setPendingColumnId(columnId);
    try {
      const result = await runApiEffect(
        addItemEffect(
          roomId,
          participantId,
          connectionToken,
          nextText,
          columnId,
        ),
      );
      if (!result.success) {
        setColumnErrors((current) => ({
          ...current,
          [columnId]: result.error ?? "Failed to add card.",
        }));
        return;
      }
      setColumnInputs((current) => ({ ...current, [columnId]: "" }));
      restoreColumnFocusRef.current = columnId;
      setPendingColumnId(null);
      setLocalRoomState(
        await Effect.runPromise(
          refreshRoomStateAfterMutationEffect(
            roomState,
            getRoomStateEffect(roomId, participantId, connectionToken),
            (current) =>
              result.item
                ? {
                    ...current,
                    items: [...current.items, result.item],
                    version: current.version + 1,
                  }
                : current,
          ),
        ),
      );
    } catch {
      setColumnErrors((current) => ({
        ...current,
        [columnId]:
          "Failed to add card. Check the room connection and try again.",
      }));
    } finally {
      setPendingColumnId(null);
    }
  }

  useEffect(() => {
    const columnId = restoreColumnFocusRef.current;
    if (!columnId || pendingColumnId !== null) return;
    restoreColumnFocusRef.current = null;
    restoreColumnInputFocus(columnId);
  }, [pendingColumnId, roomState?.version]);

  function handleStartEditItem(item: RetroItem) {
    setColumnErrors((current) => ({ ...current, __global: undefined }));
    setEditingItemId(item.id);
    setEditingItemText(item.text);
  }

  function handleCancelEditItem() {
    setEditingItemId(null);
    setEditingItemText("");
  }

  async function handleSubmitEditItem(event: React.FormEvent, itemId: string) {
    event.preventDefault();
    if (!roomId || pendingItemId) return;
    if (!isValidItemText(editingItemText)) return;
    setColumnErrors((current) => ({ ...current, __global: undefined }));
    const nextText = sanitizeItemText(editingItemText);
    setPendingItemId(itemId);
    try {
      const result = await runApiEffect(
        editItemEffect(
          roomId,
          participantId,
          connectionToken,
          itemId,
          nextText,
        ),
      );
      if (!result.success) {
        setColumnErrors((current) => ({
          ...current,
          __global: result.error ?? "Failed to edit card.",
        }));
        return;
      }
      setEditingItemId(null);
      setEditingItemText("");
      setLocalRoomState(
        await Effect.runPromise(
          refreshRoomStateAfterMutationEffect(
            roomState,
            getRoomStateEffect(roomId, participantId, connectionToken),
            (current) => ({
              ...current,
              items: current.items.map((item) =>
                item.id === itemId ? { ...item, text: nextText } : item,
              ),
              version: current.version + 1,
            }),
          ),
        ),
      );
    } catch {
      setColumnErrors((current) => ({
        ...current,
        __global:
          "Failed to edit card. Check the room connection and try again.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!roomId || pendingItemId) return;
    setColumnErrors((current) => ({ ...current, __global: undefined }));
    setPendingItemId(itemId);
    try {
      const result = await runApiEffect(
        deleteItemEffect(roomId, participantId, connectionToken, itemId),
      );
      if (!result.success) {
        setColumnErrors((current) => ({
          ...current,
          __global: result.error ?? "Failed to delete card.",
        }));
        return;
      }
      if (editingItemId === itemId) handleCancelEditItem();
      setLocalRoomState(
        await Effect.runPromise(
          refreshRoomStateAfterMutationEffect(
            roomState,
            getRoomStateEffect(roomId, participantId, connectionToken),
            (current) => ({
              ...current,
              items: current.items.filter((item) => item.id !== itemId),
              version: current.version + 1,
            }),
          ),
        ),
      );
    } catch {
      setColumnErrors((current) => ({
        ...current,
        __global:
          "Failed to delete card. Check the room connection and try again.",
      }));
    } finally {
      setPendingItemId(null);
    }
  }

  return {
    columnInputs,
    columnErrors,
    columnInputRefs,
    pendingColumnId,
    pendingItemId,
    editingItemId,
    editingItemText,
    handleColumnInputChange,
    handleAddItem,
    handleStartEditItem,
    setEditingItemText,
    handleSubmitEditItem,
    handleCancelEditItem,
    handleDeleteItem,
  };
}
