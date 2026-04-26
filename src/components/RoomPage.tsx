import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ClipboardCheck,
  Clock3,
  Columns3,
  Copy,
  DoorOpen,
  Loader2,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Vote,
  X,
} from "lucide-react";
import { ApiError, joinRoom, getRoomState, setVoteBudget, setPhase } from "../api";
import { useRoom } from "../hooks";
import type { RoomState, Phase, Column, RetroItem } from "../domain";
import { sanitizeItemText, isValidItemText, PHASE_ORDER, sanitizeColumnName, isValidColumnName, MAX_COLUMN_NAME_LENGTH, MAX_COLUMNS } from "../domain";
import { OrganiseBoard } from "./OrganiseBoard";
import { VoteBoard } from "./VoteBoard";
import { ReviewBoard } from "./ReviewBoard";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type PageState = "loading" | "join" | "room" | "not-found" | "load-error";
type RoomLoadError = {
  title: string;
  description: string;
  detail: string;
};

function mergeRoomState(local: RoomState | null, ws: RoomState | null): RoomState | null {
  if (!local && !ws) return null;
  if (!local) return ws;
  if (!ws) return local;
  if (ws.version >= local.version) return ws;
  return local;
}

function TimerDisplay({ timer }: { timer: RoomState["timer"] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer.startedAt === null || timer.durationSeconds === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timer.startedAt, timer.durationSeconds]);

  if (timer.startedAt === null || timer.durationSeconds === null) {
    return <span className="timer-display">No timer set</span>;
  }

  const elapsed = (now - timer.startedAt) / 1000;
  const remaining = Math.max(0, timer.durationSeconds - elapsed);
  const expired = remaining <= 0;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <span className={`timer-display${expired ? " timer-display--expired" : " timer-display--running"}`}>
      {expired ? "⏰ Timer expired" : `⏱ ${mins}:${secs.toString().padStart(2, "0")} remaining`}
    </span>
  );
}

function getStoredIdentity(roomId: string): { participantId: string; displayName: string; connectionToken?: string } {
  const pidKey = `retro-participant-${roomId}`;
  const nameKey = `retro-name-${roomId}`;
  const tokenKey = `retro-token-${roomId}`;
  const participantId = localStorage.getItem(pidKey) ?? crypto.randomUUID();
  const displayName = localStorage.getItem(nameKey) ?? "";
  const connectionToken = localStorage.getItem(tokenKey) ?? undefined;
  if (!localStorage.getItem(pidKey)) {
    localStorage.setItem(pidKey, participantId);
  }
  return { participantId, displayName, connectionToken };
}

function classifyRoomLoadError(error: unknown): RoomLoadError {
  if (error instanceof ApiError && error.status && error.status >= 500) {
    return {
      title: "Room temporarily unavailable",
      description: "The room service returned an error while checking this invite.",
      detail: "Retry in a moment. If the problem continues, return home and create a fresh room.",
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      title: "You appear to be offline",
      description: "We could not check this room because your browser is offline.",
      detail: "Reconnect to the internet, then retry loading the room.",
    };
  }

  return {
    title: "Could not load room",
    description: "We could not check this invite because the network request failed.",
    detail: "Check your connection and retry. Your participant credentials are not included in the room link.",
  };
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <Badge
      variant="secondary"
      className="connection-badge"
      aria-live="polite"
      aria-label={connected ? "Connected" : "Disconnected"}
    >
      <span
        className={`connection-dot ${connected ? "connection-dot--connected" : "connection-dot--disconnected"}`}
        aria-hidden="true"
      />
      <span className="connection-badge__text">{connected ? "Connected" : "Disconnected"}</span>
    </Badge>
  );
}

function InviteButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copySupported] = useState(() => typeof navigator !== "undefined" && typeof navigator.clipboard !== "undefined");
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (manualUrl) {
      manualInputRef.current?.focus();
      manualInputRef.current?.select();
    }
  }, [manualUrl]);

  function handleInvite() {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    if (copySupported) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        setCopied(true);
        setCopyFailed(false);
        setManualUrl(null);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        // fallback: show manual URL for selection
        setCopied(false);
        setCopyFailed(true);
        setManualUrl(inviteUrl);
      });
    } else {
      // No clipboard API: expose URL for manual selection
      setCopied(false);
      setCopyFailed(true);
      setManualUrl(inviteUrl);
    }
  }

  const accessibleLabel = copied
    ? "Room invite link copied!"
    : copyFailed
    ? "Copy failed — select the URL below"
    : "Copy room invite link";

  return (
    <div className="invite-control">
      <Button
        ref={buttonRef}
        variant={copied ? "default" : copyFailed ? "destructive" : "secondary"}
        size="sm"
        className={`invite-btn${copied ? " invite-btn--copied" : ""}`}
        onClick={handleInvite}
        aria-label={accessibleLabel}
        type="button"
      >
        {copied ? (
          <>
            <ClipboardCheck aria-hidden="true" />
            Copied!
          </>
        ) : copyFailed ? (
          <>
            <AlertTriangle aria-hidden="true" />
            Error
          </>
        ) : (
          <>
            <Copy aria-hidden="true" />
            Invite
          </>
        )}
      </Button>
      {manualUrl && (
        <div className="invite-control__fallback" role="alert">
          <span>Copy failed. Select this safe room URL manually:</span>
          <Input
          ref={manualInputRef}
          type="text"
          readOnly
          value={manualUrl}
          aria-label="Room invite URL — select and copy manually"
            className="h-8 w-[min(18rem,80vw)] text-xs"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        </div>
      )}
    </div>
  );
}

function ParticipantList({ participants, currentId }: { participants: RoomState["participants"]; currentId: string }) {
  if (!participants || participants.length === 0) {
    return <span className="text-muted">No participants yet</span>;
  }
  return (
    <ul className="participant-list" aria-label="Participants">
      {participants.map((p) => (
        <li key={p.id}>
        <Badge variant={p.id === currentId ? "default" : "secondary"} className={`participant-chip${p.id === currentId ? " participant-chip--self" : ""}`}>
          <span className="participant-chip__name">{p.displayName}</span>
          {p.isFacilitator && (
            <span className="facilitator-badge facilitator-badge--sm" aria-label={`${p.displayName} is facilitator`}>
              ⭐ Facilitator
            </span>
          )}
        </Badge>
        </li>
      ))}
    </ul>
  );
}

function getSortedColumns(roomState: RoomState): Column[] {
  return [...(roomState.columns ?? roomState.groups)].sort((a, b) => a.order - b.order);
}

function ColumnConfiguration({
  roomState,
  send,
  serverError,
  clearServerError,
}: {
  roomState: RoomState;
  send: (message: unknown) => boolean;
  serverError: string | null;
  clearServerError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [columnMsg, setColumnMsg] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [pendingColumnMutation, setPendingColumnMutation] = useState(false);
  const pendingColumnVersionRef = useRef<number | null>(null);
  const canMutate = roomState.phase === "write" || roomState.phase === "organise";
  const columns = getSortedColumns(roomState);
  const isAtMax = columns.length >= MAX_COLUMNS;
  const displayedError = columnError ?? (serverError && /column/i.test(serverError) ? serverError : null);

  useEffect(() => {
    if (pendingColumnMutation && pendingColumnVersionRef.current !== roomState.version) {
      pendingColumnVersionRef.current = null;
      setPendingColumnMutation(false);
      setColumnMsg(null);
    }
  }, [pendingColumnMutation, roomState.version]);

  useEffect(() => {
    if (displayedError) {
      const timeout = window.setTimeout(() => {
        pendingColumnVersionRef.current = null;
        setPendingColumnMutation(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [displayedError]);

  function clearFeedback() {
    setColumnMsg(null);
    setColumnError(null);
    clearServerError();
  }

  function validateName(raw: string): string | null {
    if (!isValidColumnName(raw)) return "Column name cannot be empty.";
    if (raw.trim().length > MAX_COLUMN_NAME_LENGTH) return `Column names must be ${MAX_COLUMN_NAME_LENGTH} characters or fewer.`;
    return null;
  }

  function handleCreateColumn(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!canMutate) {
      setColumnError("Columns can be configured during write and organise phases.");
      return;
    }
    if (isAtMax) {
      setColumnError(`Rooms can have at most ${MAX_COLUMNS} columns.`);
      return;
    }
    const validationError = validateName(newColumnName);
    if (validationError) {
      setColumnError(validationError);
      return;
    }
    if (!send({ type: "create-column", name: sanitizeColumnName(newColumnName) })) {
      setColumnError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setNewColumnName("");
    setColumnMsg("Column creation sent.");
  }

  function startEdit(column: Column) {
    clearFeedback();
    setEditingColumnId(column.id);
    setEditingName(column.name);
  }

  function submitEdit(columnId: string) {
    clearFeedback();
    const validationError = validateName(editingName);
    if (validationError) {
      setColumnError(validationError);
      return;
    }
    if (!send({ type: "edit-column", columnId, name: sanitizeColumnName(editingName) })) {
      setColumnError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setEditingColumnId(null);
    setEditingName("");
    setColumnMsg("Column rename sent.");
  }

  function moveColumn(fromIdx: number, toIdx: number) {
    clearFeedback();
    const reordered = [...columns];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) return;
    reordered.splice(toIdx, 0, moved);
    if (!send({ type: "reorder-columns", columnIds: reordered.map((column) => column.id) })) {
      setColumnError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setColumnMsg("Column reorder sent.");
  }

  function deleteColumn(column: Column) {
    clearFeedback();
    if (!canMutate) {
      setColumnError("Columns can be configured during write and organise phases.");
      return;
    }
    if (!send({ type: "delete-column", columnId: column.id })) {
      setColumnError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    if (editingColumnId === column.id) {
      setEditingColumnId(null);
      setEditingName("");
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setColumnMsg(`Column "${column.name}" deletion sent.`);
  }

  return (
    <section className="column-config" aria-label="Column configuration">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          clearFeedback();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
      >
        <Columns3 aria-hidden="true" />
        Configure columns
      </Button>

      {open && (
        <Card className="column-config__panel">
          <CardHeader className="column-config__header px-0">
            <div>
              <CardTitle className="column-config__title">Columns</CardTitle>
              <CardDescription className="column-config__hint">
                Facilitators can configure columns during write and organise. Participants see changes live.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="column-config__count">{columns.length}/{MAX_COLUMNS}</Badge>
          </CardHeader>

          {!canMutate && (
            <div className="status-msg status-msg--muted" role="status">
              Column configuration is locked in {roomState.phase} phase.
            </div>
          )}

          <form className="column-config__form" onSubmit={handleCreateColumn}>
            <Input
              className={`input${displayedError ? " input--error" : ""}`}
              type="text"
              value={newColumnName}
              onChange={(event) => {
                setNewColumnName(event.target.value);
                if (columnError) setColumnError(null);
              }}
              maxLength={MAX_COLUMN_NAME_LENGTH}
              placeholder="New column name…"
              aria-label="New column name"
              disabled={!canMutate || isAtMax || pendingColumnMutation}
            />
            <Button
              variant="secondary"
              size="sm"
              type="submit"
              disabled={!canMutate || isAtMax || pendingColumnMutation}
              aria-busy={pendingColumnMutation}
            >
              {pendingColumnMutation ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {pendingColumnMutation ? "Adding…" : "Add column"}
            </Button>
          </form>

          {displayedError && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>{displayedError}</AlertDescription>
            </Alert>
          )}
          {columnMsg && !displayedError && (
            <div className="status-msg status-msg--info" role="status">
              {columnMsg}
            </div>
          )}

          <ol className="column-config__list" aria-label="Configured columns">
            {columns.map((column, index) => (
              <li key={column.id} className="column-config__item">
                <span className="column-config__order" aria-label={`Column order ${index + 1}`}>{index + 1}</span>
                {editingColumnId === column.id ? (
                  <Input
                    className="input column-config__edit-input"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    maxLength={MAX_COLUMN_NAME_LENGTH}
                    aria-label={`Edit ${column.name} column name`}
                    autoFocus
                  />
                ) : (
                  <span className="column-config__name" title={column.name}>{column.name}</span>
                )}
                <span className="column-config__actions">
                  {editingColumnId === column.id ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => submitEdit(column.id)}
                        disabled={pendingColumnMutation}
                        aria-busy={pendingColumnMutation}
                      >
                        {pendingColumnMutation ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
                        {pendingColumnMutation ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="reorder-btn" onClick={() => setEditingColumnId(null)} aria-label="Cancel column edit">
                        <X aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="secondary" size="sm" onClick={() => startEdit(column)} disabled={!canMutate || pendingColumnMutation}>
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="icon" className="reorder-btn" onClick={() => moveColumn(index, index - 1)} disabled={!canMutate || pendingColumnMutation || index === 0} aria-label={`Move ${column.name} column left`}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="reorder-btn" onClick={() => moveColumn(index, index + 1)} disabled={!canMutate || pendingColumnMutation || index === columns.length - 1} aria-label={`Move ${column.name} column right`}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="reorder-btn reorder-btn--danger" onClick={() => deleteColumn(column)} disabled={!canMutate || pendingColumnMutation} aria-label={`Delete ${column.name} column`}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}

function WriteColumnBoard({ roomState }: { roomState: RoomState }) {
  const columns = getSortedColumns(roomState);
  const unassigned = roomState.items.filter((item) => (item.columnId ?? item.groupId) === null).sort((a, b) => a.order - b.order);

  function renderItem(item: RetroItem, index: number) {
    const isLong = item.text.length > 400;
    const author = roomState.participants.find((p) => p.id === item.authorId);
    return (
      <li key={item.id} className={`item-card${isLong ? " item-card--long" : ""}`}>
        <div className="item-card__content">
          <span className="item-card__text">{item.text}</span>
          {isLong && (
            <span className="item-card__length-indicator" aria-label={`${item.text.length} characters`}>
              {item.text.length}/500
            </span>
          )}
        </div>
        <div className="item-card__meta">
          <span className="item-card__author">{author?.displayName ?? "Unknown"}</span>
          <span className="item-card__index" aria-label={`Item ${index + 1}`}>#{index + 1}</span>
        </div>
      </li>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="write-empty-state empty-state" role="status" aria-live="polite">
        <div className="empty-state__icon" aria-hidden="true">🧱</div>
        <h3 className="empty-state__title">Create your first column</h3>
        <p className="empty-state__text">
          This room starts with an empty kanban board. Ask the facilitator to configure list-style columns before adding retro items.
        </p>
      </div>
    );
  }

  return (
    <div className="column-board" aria-label="Write phase columns">
      {columns.map((column) => {
        const items = roomState.items
          .filter((item) => item.columnId === column.id && item.groupId === null)
          .sort((a, b) => a.order - b.order);
        return (
          <Card key={column.id} className="column-board__column" role="region" aria-labelledby={`write-column-${column.id}`} data-column-id={column.id}>
              <CardHeader className="column-board__header px-0">
                <CardTitle id={`write-column-${column.id}`} role="heading" aria-level={3} className="column-board__title" title={column.name}>{column.name}</CardTitle>
                <Badge variant="secondary" className="column-board__count" aria-label={`${items.length} items`}>{items.length}</Badge>
              </CardHeader>
              <CardContent className="px-0">
                {items.length === 0 ? (
                  <p className="text-muted column-board__empty">No items in this lane yet. Choose “{column.name}” above to add one.</p>
                ) : (
                  <ul className="item-list" aria-label={`${column.name} items`}>
                    {items.map((item, index) => renderItem(item, index))}
                  </ul>
                )}
              </CardContent>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card className="column-board__column column-board__column--secondary" aria-labelledby="write-column-unassigned">
          <CardHeader className="column-board__header px-0">
            <CardTitle id="write-column-unassigned" role="heading" aria-level={3} className="column-board__title">Unassigned</CardTitle>
            <Badge variant="secondary" className="column-board__count">{unassigned.length}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="item-list">
              {unassigned.map((item, index) => renderItem(item, index))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [identity] = useState(() => getStoredIdentity(roomId!));
  const [participantId] = useState(() => identity.participantId);
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [roomLoadError, setRoomLoadError] = useState<RoomLoadError | null>(null);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => identity.connectionToken);
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [timerInputError, setTimerInputError] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);
  const [budgetPending, setBudgetPending] = useState(false);
  const [phasePending, setPhasePending] = useState(false);
  const [timerPending, setTimerPending] = useState(false);
  const phaseStatusRef = useRef<HTMLDivElement>(null);
  const previousRoomUpdateRef = useRef<{ phase: Phase; version: number } | null>(null);
  const initialLoadStartedRef = useRef(false);

  const { state: wsState, connected, lastError, clearError, send } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);

  const [itemInput, setItemInput] = useState("");
  const [itemError, setItemError] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);

  const isNearCharLimit = itemInput.length > 400;
  const charCountId = "item-char-count";
  const itemErrorId = "item-error";
  const sortedRoomColumns = roomState ? getSortedColumns(roomState) : [];
  const hasConfiguredColumns = sortedRoomColumns.length > 0;
  const effectiveSelectedColumnId = selectedColumnId && sortedRoomColumns.some((column) => column.id === selectedColumnId)
    ? selectedColumnId
    : sortedRoomColumns[0]?.id ?? null;

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimerPending(false), 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.timer.startedAt, roomState?.timer.durationSeconds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPhaseMsg(null);
      setBudgetMsg(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.phase, roomState?.voteBudget]);

  useEffect(() => {
    if (pageState !== "room" || !roomState) return;
    const previous = previousRoomUpdateRef.current;
    previousRoomUpdateRef.current = { phase: roomState.phase, version: roomState.version };
    if (!previous) return;

    const changed = previous.phase !== roomState.phase || previous.version !== roomState.version;
    const activeElement = document.activeElement;
    const focusLostToBody = activeElement === document.body || activeElement === document.documentElement || activeElement === null;
    if (changed && focusLostToBody) {
      window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
    }
  }, [pageState, roomState?.phase, roomState?.version, roomState]);

  const loadInitialRoom = useCallback(async () => {
    if (!roomId) return;
    setPageState("loading");
    setRoomLoadError(null);
    try {
      const state = await getRoomState(roomId);
      setLocalRoomState(state);
      const existing = state.participants.find((p) => p.id === participantId);
      if (existing) {
        const name = identity.displayName || existing.displayName;
        try {
          const result = await joinRoom(roomId, participantId, name);
          if (result.success) {
            localStorage.setItem(`retro-name-${roomId}`, name);
            setLocalRoomState(result.state ?? state);
            if (result.connectionToken) {
              localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
              setConnectionToken(result.connectionToken);
            }
          }
        } catch {
          // Re-join failed; still show room with stale token if available
        }
        setPageState("room");
      } else {
        setPageState("join");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setPageState("not-found");
        return;
      }
      setRoomLoadError(classifyRoomLoadError(error));
      setPageState("load-error");
    }
  }, [roomId, participantId, identity.displayName]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return undefined;
    const timeout = window.setTimeout(() => {
      if (initialLoadStartedRef.current) return;
      initialLoadStartedRef.current = true;
      void loadInitialRoom();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadInitialRoom]);

  const displayBudget = roomState ? String(roomState.voteBudget) : voteBudgetInput;

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId) return;
    setJoinError(null);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setJoinError("Please enter a display name.");
      return;
    }

    setJoinLoading(true);
    try {
      const result = await joinRoom(roomId, participantId, trimmed);
      if (!result.success) {
        setJoinError(result.error ?? "Failed to join room. Please try again.");
        return;
      }
      localStorage.setItem(`retro-name-${roomId}`, trimmed);
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
        setConnectionToken(result.connectionToken);
      }
      setPageState("room");
    } catch {
      setJoinError("Failed to join room. Please check your connection and try again.");
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleSetBudget() {
    if (!roomId || budgetPending) return;
    setBudgetMsg(null);
    const budget = parseInt(voteBudgetInput, 10);
    if (isNaN(budget) || budget < 1 || budget > 100) {
      setBudgetMsg("Vote budget must be between 1 and 100.");
      return;
    }
    setBudgetPending(true);
    try {
      const result = await setVoteBudget(roomId, participantId, budget);
      if (result.success) {
        setBudgetMsg("Vote budget updated.");
        // Refetch authoritative state to handle any missed WebSocket broadcasts during reconnect
        try {
          const state = await getRoomState(roomId);
          setLocalRoomState(state);
        } catch {
          // Refetch failed; local optimistic update stands and WebSocket will reconcile
        }
      } else {
        setBudgetMsg(result.error ?? "Failed to update budget.");
      }
    } finally {
      setBudgetPending(false);
    }
  }

  async function handleAdvancePhase() {
    if (!roomId || !roomState || phasePending) return;
    setPhaseMsg(null);
    const currentIdx = PHASE_ORDER.indexOf(roomState.phase);
    const nextPhase = PHASE_ORDER[currentIdx + 1] as Phase | undefined;
    if (!nextPhase) return;
    setPhasePending(true);
    try {
      const result = await setPhase(roomId, participantId, nextPhase);
      if (result.success) {
        setPhaseMsg(`Advanced to ${nextPhase}.`);
        window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
        // Refetch authoritative state so the UI updates even if the WebSocket broadcast
        // was missed during a post-reload reconnect window
        try {
          const state = await getRoomState(roomId);
          setLocalRoomState(state);
        } catch {
          // Refetch failed; local optimistic update stands and WebSocket will reconcile
        }
      } else {
        setPhaseMsg(result.error ?? "Failed to change phase.");
      }
    } finally {
      setPhasePending(false);
    }
  }

  function handleSetTimer() {
    if (!roomState || timerPending) return;
    setTimerMsg(null);
    setTimerInputError(null);
    const raw = timerMinutesInput.trim();
    if (!raw) {
      setTimerInputError("Timer cannot be blank.");
      return;
    }
    const minutes = parseInt(raw, 10);
    if (isNaN(minutes) || minutes < 1) {
      setTimerInputError("Timer must be at least 1 minute.");
      return;
    }
    if (minutes > 60) {
      setTimerInputError("Timer cannot exceed 60 minutes.");
      return;
    }
    const durationSeconds = minutes * 60;
    if (!send({ type: "set-timer", durationSeconds })) {
      setTimerInputError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    setTimerPending(true);
    setTimerMsg("Timer started.");
  }

  function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setItemError(null);
    if (!isValidItemText(itemInput)) {
      setItemError("Item text cannot be blank.");
      return;
    }
    if (!effectiveSelectedColumnId) {
      setItemError("Create a column before adding items.");
      return;
    }
    if (!send({ type: "add-item", text: sanitizeItemText(itemInput), columnId: effectiveSelectedColumnId })) {
      setItemError("Reconnecting. Please try again once the room is connected.");
      return;
    }
    setItemInput("");
  }

  if (pageState === "loading") {
    return (
      <main className="state-surface" aria-labelledby="loading-title">
        <Card className="state-card loading-state" role="status" aria-label="Loading room">
          <CardHeader className="items-center text-center">
            <div className="state-card__icon" aria-hidden="true">
              <Loader2 className="loading-spinner" />
            </div>
            <CardTitle id="loading-title" role="heading" aria-level={1}>Loading room…</CardTitle>
            <CardDescription>
              Checking the room and restoring your local identity if one exists.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (pageState === "not-found") {
    return (
      <main className="state-surface" aria-labelledby="not-found-title">
        <Card className="state-card empty-state">
          <CardHeader className="items-center text-center">
            <div className="state-card__icon" role="img" aria-label="Room not found">🔍</div>
            <CardTitle id="not-found-title" role="heading" aria-level={1} className="text-2xl">Room Not Found</CardTitle>
            <CardDescription>
              This room does not exist, has been closed, or the link may be incorrect. Check the invite link or start a new room.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <a href="/">Return Home</a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (pageState === "load-error") {
    const errorState = roomLoadError ?? classifyRoomLoadError(null);
    return (
      <main className="state-surface" aria-labelledby="room-load-error-title">
        <Card className="state-card empty-state" role="alert">
          <CardHeader className="items-center text-center">
            <div className="state-card__icon" role="img" aria-label="Room load error">
              <AlertTriangle aria-hidden="true" />
            </div>
            <CardTitle id="room-load-error-title" role="heading" aria-level={1} className="text-2xl">
              {errorState.title}
            </CardTitle>
            <CardDescription>
              {errorState.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 text-center">
            <p className="text-muted">{errorState.detail}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button type="button" onClick={() => void loadInitialRoom()}>
                <RefreshCw aria-hidden="true" />
                Retry loading room
              </Button>
              <Button asChild variant="secondary">
                <a href="/">Return Home</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (pageState === "join") {
    return (
      <main className="state-surface" aria-labelledby="join-title">
        <Card className="state-card join-card">
          <CardHeader>
            <div className="join-card__badge">
              <DoorOpen aria-hidden="true" size={16} />
              Room invite
            </div>
            <CardTitle id="join-title" role="heading" aria-level={1} className="text-2xl">Join Room</CardTitle>
            <CardDescription>
              Enter the name teammates will see in this retrospective. Your name is stored only in this browser for reconnects.
            </CardDescription>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleJoin} noValidate className="join-card__form">
            <div className="input-group">
              <label className="input-label" htmlFor="displayName">
                Display Name
              </label>
              <Input
                id="displayName"
                className={joinError ? "input--error" : undefined}
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                maxLength={50}
                placeholder="Your name"
                autoComplete="nickname"
                aria-required="true"
                aria-describedby={joinError ? "join-error" : undefined}
                aria-invalid={joinError ? "true" : undefined}
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={joinLoading}
              aria-busy={joinLoading}
            >
              {joinLoading ? (
                <>
                  <Loader2 className="loading-spinner" aria-hidden="true" />
                  Joining…
                </>
              ) : "Join Room"}
            </Button>
            {joinLoading && (
              <p className="join-card__status" role="status" aria-live="polite">
                Joining room and establishing a private reconnect token…
              </p>
            )}
            {joinError && (
              <Alert id="join-error" variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Could not join</AlertTitle>
                <AlertDescription>{joinError}</AlertDescription>
              </Alert>
            )}
          </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const currentParticipant = roomState?.participants.find((p) => p.id === participantId);
  const isFacilitator = currentParticipant?.isFacilitator === true;

  return (
    <div className="content-shell">
      {/* Room Header */}
      <header className="room-header" role="banner">
        <div className="room-header__left">
          <h1 className="room-header__title">Retro Board</h1>
          <ConnectionStatus connected={connected} />
          {!connected && (
            <Badge variant="secondary" role="status" aria-live="polite" className="room-header__offline">
              <Radar aria-hidden="true" />
              Reconnecting — content remains readable
            </Badge>
          )}
        </div>
        <div className="room-header__right">
          <span className="room-header__privacy">
            <ShieldCheck aria-hidden="true" />
            Safe invite
          </span>
          <InviteButton roomId={roomId!} />
        </div>
      </header>

      {/* Phase Status Bar */}
      <Card ref={phaseStatusRef} className="phase-status" role="region" aria-label="Room status" tabIndex={-1}>
        <span className="phase-status__label">Phase: </span>
        <Badge
          className="phase-status__value badge--phase"
          data-phase={roomState?.phase?.toUpperCase() ?? "UNKNOWN"}
        >
          {roomState?.phase?.toUpperCase() ?? "UNKNOWN"}
        </Badge>
        <TimerDisplay timer={roomState?.timer ?? { startedAt: null, durationSeconds: null, expired: false }} />
      </Card>

      {/* Participants */}
      <section
        className="participants-bar"
        role="region"
        aria-label="Participants"
        style={{ marginBottom: "var(--space-4)" }}
      >
        <h2 className="section-title">
          <Users aria-hidden="true" size={14} />
          Participants
        </h2>
        <ParticipantList participants={roomState?.participants ?? []} currentId={participantId} />
      </section>

      {/* Facilitator Controls */}
      {isFacilitator && (
        <Card className="facilitator-panel" role="region" aria-label="Facilitator controls">
          <CardHeader className="px-0">
            <CardTitle className="facilitator-panel__title">
              <ShieldCheck aria-hidden="true" size={14} />
              Facilitator Controls
            </CardTitle>
            <CardDescription>
              Server-authoritative controls for phase progression, timing, vote budget, and board columns.
            </CardDescription>
          </CardHeader>
          <CardContent className="facilitator-panel__controls px-0">
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="voteBudget">
                <Vote aria-hidden="true" size={14} />
                Vote Budget
              </label>
              <Input
                id="voteBudget"
                className={`input${budgetMsg && budgetMsg.includes("must be") ? " input--error" : ""}`}
                type="number"
                min={1}
                max={100}
                value={displayBudget}
                onChange={(e) => {
                  setVoteBudgetInput(e.target.value);
                  if (budgetMsg) setBudgetMsg(null);
                }}
                style={{ width: "5rem" }}
                aria-describedby={budgetMsg && budgetMsg.includes("must be") ? "budget-error" : undefined}
                aria-invalid={budgetMsg && budgetMsg.includes("must be") ? "true" : undefined}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSetBudget}
                disabled={budgetPending}
                aria-busy={budgetPending}
              >
                {budgetPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {budgetPending ? "Saving…" : "Set"}
              </Button>
              {budgetMsg && budgetMsg.includes("must be") ? (
                <span id="budget-error" className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
                  {budgetMsg}
                </span>
              ) : budgetMsg ? (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {budgetMsg}
                </span>
              ) : null}
            </div>
            <div className="facilitator-panel__row">
              <Button
                onClick={handleAdvancePhase}
                disabled={roomState?.phase === "review" || phasePending}
                aria-busy={phasePending}
                aria-label="Advance to next phase"
              >
                {phasePending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                {phasePending ? "Advancing…" : "Advance to Next Phase"}
              </Button>
              {phaseMsg && (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {phaseMsg}
                </span>
              )}
            </div>
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="timerMinutes">
                <Clock3 aria-hidden="true" size={14} />
                Timer (minutes)
              </label>
              <Input
                id="timerMinutes"
                className={`input${timerInputError ? " input--error" : ""}`}
                type="number"
                min={1}
                max={60}
                value={timerMinutesInput}
                onChange={(e) => {
                  setTimerMinutesInput(e.target.value);
                  if (timerInputError) setTimerInputError(null);
                }}
                style={{ width: "5rem" }}
                aria-describedby={timerInputError ? "timer-error" : undefined}
                aria-invalid={timerInputError ? "true" : undefined}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSetTimer}
                disabled={timerPending}
                aria-busy={timerPending}
              >
                {timerPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                {timerPending ? "Starting…" : "Start Timer"}
              </Button>
              {timerInputError && (
                <span id="timer-error" className="status-msg status-msg--error" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="alert">
                  {timerInputError}
                </span>
              )}
              {timerMsg && !timerInputError && (
                <span className="status-msg status-msg--info" style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--text-xs)" }} role="status">
                  {timerMsg}
                </span>
              )}
            </div>
            {roomState && (
              <ColumnConfiguration
                roomState={roomState}
                send={send}
                serverError={lastError}
                clearServerError={clearError}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Board Area */}
      <Card className="board-area glass-panel">
        <div className="board-header">
          <h2 className="section-title">
            <Columns3 aria-hidden="true" size={14} />
            Board
          </h2>
          {roomState?.phase === "write" && (
            <span className="phase-hint" aria-hidden="true">Add your retro items</span>
          )}
        </div>

        {/* Write Phase Composer */}
        {roomState?.phase === "write" && (
          <Card className="write-composer">
            <form
              onSubmit={handleAddItem}
              className="write-composer__form"
              aria-label="Add retro item"
            >
              <div className="write-composer__input-row">
                <label className="sr-only" htmlFor="itemColumn">Column</label>
                <select
                  id="itemColumn"
                  className="input write-composer__column-select"
                  value={effectiveSelectedColumnId ?? ""}
                  onChange={(event) => setSelectedColumnId(event.target.value)}
                  disabled={!connected || !hasConfiguredColumns}
                  aria-label="Column for new item"
                >
                  {!hasConfiguredColumns && (
                    <option value="">No columns yet</option>
                  )}
                  {sortedRoomColumns.map((column) => (
                    <option key={column.id} value={column.id}>{column.name}</option>
                  ))}
                </select>
                <div className="write-composer__input-wrapper">
                  <Input
                    type="text"
                    id="itemText"
                    className={`input write-composer__input${itemError ? " input--error" : ""}`}
                    value={itemInput}
                    onChange={(e) => {
                      setItemInput(e.target.value);
                      if (itemError) setItemError(null);
                    }}
                    maxLength={500}
                    placeholder="Add a retro item…"
                    aria-required="true"
                    aria-describedby={[itemError ? itemErrorId : "", isNearCharLimit ? charCountId : ""].filter(Boolean).join(" ") || undefined}
                    aria-invalid={itemError ? "true" : undefined}
                    disabled={!connected || !hasConfiguredColumns}
                  />
                  {isNearCharLimit && (
                    <span
                      id={charCountId}
                      className="write-composer__char-count"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {itemInput.length}/500
                    </span>
                  )}
                </div>
                <Button
                  type="submit"
                  className="write-composer__submit"
                  disabled={!connected || !hasConfiguredColumns || !itemInput.trim()}
                  aria-label="Add item"
                >
                  <Send aria-hidden="true" />
                  Add
                </Button>
              </div>
              {itemError && (
                <div id={itemErrorId} className="status-msg status-msg--error write-composer__error" role="alert">
                  {itemError}
                </div>
              )}
              {!connected && (
                <div className="status-msg status-msg--muted write-composer__offline" role="status" aria-live="polite">
                  <span aria-hidden="true">⏳</span> Reconnect to add items. Existing room content remains readable.
                </div>
              )}
              {connected && !hasConfiguredColumns && (
                <div className="status-msg status-msg--muted write-composer__offline" role="status" aria-live="polite">
                  <span aria-hidden="true">🧱</span> No columns yet. Facilitators can use Configure columns to create lanes.
                </div>
              )}
            </form>
          </Card>
        )}

        {roomState?.phase === "organise" ? (
          <OrganiseBoard
            roomState={roomState}
            isFacilitator={isFacilitator}
            send={send}
            serverError={lastError}
            clearServerError={clearError}
          />
        ) : roomState?.phase === "vote" ? (
          <VoteBoard
            roomState={roomState}
            participantId={participantId}
            send={send}
            serverError={lastError}
            clearServerError={clearError}
          />
        ) : roomState?.phase === "review" ? (
          <ReviewBoard roomState={roomState} />
        ) : roomState?.phase === "write" ? (
          <WriteColumnBoard roomState={roomState} />
        ) : null}
      </Card>

      {/* Room Footer — safe room code only, no tokens */}
      <footer className="room-footer" role="contentinfo">
        <span className="room-footer__label">Room</span>
        <span className="room-footer__code truncate" aria-label="Room code">
          {roomId}
        </span>
      </footer>
    </div>
  );
}
