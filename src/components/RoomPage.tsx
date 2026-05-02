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
  ShieldCheck,
  Trash2,
  Users,
  Vote,
  X,
} from "lucide-react";
import { ApiError, addItem, deleteItem, editItem, joinRoom, getRoomState, purgeRoom, setVoteBudget, setRankingMethod, setPhase, setTimer } from "../api";
import { useRoom } from "../hooks";
import type { RoomState, Phase, Column, RetroItem, RankingMethod } from "../domain";
import { sanitizeItemText, isValidItemText, PHASE_ORDER, sanitizeColumnName, isValidColumnName, MAX_COLUMN_NAME_LENGTH, MAX_COLUMNS, itemVoteTarget } from "../domain";
import { OrganiseBoard } from "./OrganiseBoard";
import { VoteBoard } from "./VoteBoard";
import { ReviewBoard } from "./ReviewBoard";
import { FinalBoard } from "./FinalBoard";
import { ReactionBar } from "./Reactions";
import { submitFormOnModEnter } from "./form-shortcuts";
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

const PHASE_LABELS: Record<Phase, string> = {
  setup: "Setup",
  write: "Write",
  organise: "Organise",
  vote: "Vote",
  review: "Review",
  finalize: "Finalize",
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
      {expired ? "Timer expired" : `${mins}:${secs.toString().padStart(2, "0")} remaining`}
    </span>
  );
}

function ElapsedRetroClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <span className="elapsed-clock">{formatElapsedTime(Math.max(0, now - startedAt))}</span>;
}

function PhaseProgress({ phase, startedAt }: { phase: Phase; startedAt: number }) {
  const currentIndex = PHASE_ORDER.indexOf(phase);

  return (
    <Card className="retro-progress" role="region" aria-label="Retro progress">
      <div className="retro-progress__header">
        <span className="retro-progress__label">Retro progress</span>
        <span className="retro-progress__elapsed" aria-label="Retro elapsed time">
          Running for <ElapsedRetroClock startedAt={startedAt} />
        </span>
      </div>
      <ol className="retro-steps" aria-label="Retro steps">
        {PHASE_ORDER.map((step, index) => {
          const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          return (
            <li key={step} className={`retro-step retro-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="retro-step__dot" aria-hidden="true">{index + 1}</span>
              <span className="retro-step__label">{PHASE_LABELS[step]}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

function getFacilitatorClaimToken(roomId: string): string | undefined {
  return sessionStorage.getItem(`retro-facilitator-claim-${roomId}`) ?? undefined;
}

function clearStoredIdentity(roomId: string): void {
  localStorage.removeItem(`retro-participant-${roomId}`);
  localStorage.removeItem(`retro-name-${roomId}`);
  localStorage.removeItem(`retro-token-${roomId}`);
  sessionStorage.removeItem(`retro-facilitator-claim-${roomId}`);
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
              Facilitator
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
  const [open, setOpen] = useState(() => roomState.phase === "setup");
  const [newColumnName, setNewColumnName] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [columnMsg, setColumnMsg] = useState<string | null>(null);
  const [columnError, setColumnError] = useState<string | null>(null);
  const [pendingColumnMutation, setPendingColumnMutation] = useState(false);
  const pendingColumnVersionRef = useRef<number | null>(null);
  const canMutate = roomState.phase === "setup";
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
      setColumnError("Columns can only be configured during setup.");
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
      setColumnError("Columns can only be configured during setup.");
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
                Facilitators configure columns during setup. They lock before writing starts so later votes and exports stay consistent.
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
              onKeyDown={submitFormOnModEnter}
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

function SetupBoard({
  roomState,
  isFacilitator,
  send,
  serverError,
  clearServerError,
  onRankingMethodChange,
  rankingPending,
  rankingMsg,
}: {
  roomState: RoomState;
  isFacilitator: boolean;
  send: (message: unknown) => boolean;
  serverError: string | null;
  clearServerError: () => void;
  onRankingMethodChange: (rankingMethod: RankingMethod) => void;
  rankingPending: boolean;
  rankingMsg: string | null;
}) {
  const methods: Array<{
    id: RankingMethod;
    title: string;
    eyebrow: string;
    description: string;
  }> = [
    {
      id: "score",
      title: "Score voting",
      eyebrow: "Best default",
      description: "Each participant gets a small vote budget and spends points on the most important items within the vote board.",
    },
    {
      id: "pairwise",
      title: "Pairwise ranking",
      eyebrow: "Small groups",
      description: "Participants choose between two items at a time inside each column. Results rank by comparison wins.",
    },
  ];

  if (!isFacilitator) {
    return (
      <div className="setup-board setup-board--waiting" aria-label="Waiting for setup">
        <section className="setup-panel setup-panel--waiting">
          <div className="setup-waiting__icon" aria-hidden="true">
            <Clock3 size={18} />
          </div>
          <div>
            <p className="review-slide__eyebrow">Setup in progress</p>
            <h3>Waiting for the facilitator</h3>
            <p className="setup-panel__copy">
              The facilitator is choosing the room settings. You will move into writing automatically when setup is complete.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="setup-board" aria-label="Setup retro board">
      <section className="setup-panel setup-panel--ranking">
        <div className="setup-panel__header">
          <div>
            <p className="review-slide__eyebrow">Step 1</p>
            <h3>Set up the board</h3>
          </div>
          <Badge variant="secondary">Locks after setup</Badge>
        </div>
        <p className="setup-panel__copy">
          Choose the board columns and the decision method before participants start writing. This keeps later grouping, ranking, review, and exports stable.
        </p>
        <div className="ranking-method-grid" role="radiogroup" aria-label="Ranking method">
          {methods.map((method) => {
            const selected = roomState.rankingMethod === method.id;
            return (
              <button
                key={method.id}
                type="button"
                className={`ranking-method-card${selected ? " ranking-method-card--selected" : ""}`}
                onClick={() => onRankingMethodChange(method.id)}
                disabled={rankingPending}
                role="radio"
                aria-checked={selected}
              >
                <span className="ranking-method-card__eyebrow">{method.eyebrow}</span>
                <span className="ranking-method-card__title">{method.title}</span>
                <span className="ranking-method-card__description">{method.description}</span>
              </button>
            );
          })}
        </div>
        {rankingMsg && (
          <div className={`status-msg ${rankingMsg.includes("Failed") || rankingMsg.includes("only") ? "status-msg--error" : "status-msg--info"}`} role="status">
            {rankingMsg}
          </div>
        )}
      </section>

      <ColumnConfiguration
        roomState={roomState}
        send={send}
        serverError={serverError}
        clearServerError={clearServerError}
      />
    </div>
  );
}

interface WriteColumnBoardProps {
  roomState: RoomState;
  participantId: string;
  connected: boolean;
  columnInputs: Record<string, string>;
  columnErrors: Record<string, string | undefined>;
  pendingColumnId: string | null;
  editingItemId: string | null;
  editingItemText: string;
  pendingItemId: string | null;
  onColumnInputChange: (columnId: string, value: string) => void;
  onAddItem: (event: React.FormEvent, columnId: string) => void;
  onStartEdit: (item: RetroItem) => void;
  onEditTextChange: (value: string) => void;
  onSubmitEdit: (event: React.FormEvent, itemId: string) => void;
  onCancelEdit: () => void;
  onDeleteItem: (itemId: string) => void;
  send: (message: unknown) => boolean;
  columnInputRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>;
}

function WriteColumnBoard({
  roomState,
  participantId,
  connected,
  columnInputs,
  columnErrors,
  pendingColumnId,
  editingItemId,
  editingItemText,
  pendingItemId,
  onColumnInputChange,
  onAddItem,
  onStartEdit,
  onEditTextChange,
  onSubmitEdit,
  onCancelEdit,
  onDeleteItem,
  send,
  columnInputRefs,
}: WriteColumnBoardProps) {
  const columns = getSortedColumns(roomState);
  const unassigned = roomState.items.filter((item) => (item.columnId ?? item.groupId) === null).sort((a, b) => a.order - b.order);

  function renderItem(item: RetroItem, index: number) {
    const isLong = item.text.length > 400;
    const author = roomState.participants.find((p) => p.id === item.authorId);
    const isOwner = item.authorId === participantId;
    const isEditing = editingItemId === item.id;
    const editErrorId = `edit-item-error-${item.id}`;

    if (isEditing) {
      return (
        <li key={item.id} className={`item-card item-card--editing${isLong ? " item-card--long" : ""}`}>
          <form className="item-card__edit-form" onSubmit={(event) => onSubmitEdit(event, item.id)}>
            <label className="sr-only" htmlFor={`edit-item-${item.id}`}>Edit card</label>
            <textarea
              id={`edit-item-${item.id}`}
              className="input write-card-composer__textarea item-card__edit-input"
              value={editingItemText}
              onChange={(event) => onEditTextChange(event.target.value)}
              onKeyDown={submitFormOnModEnter}
              maxLength={500}
              rows={3}
              aria-describedby={editErrorId}
              autoFocus
            />
            <div className="item-card__edit-footer">
              <span id={editErrorId} className="item-card__char-count">{editingItemText.length}/500</span>
              <div className="item-card__actions">
                <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={pendingItemId === item.id}>
                  <X aria-hidden="true" /> Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pendingItemId === item.id || !editingItemText.trim()} aria-busy={pendingItemId === item.id}>
                  {pendingItemId === item.id ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
                  Save
                </Button>
              </div>
            </div>
          </form>
        </li>
      );
    }

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
        <ReactionBar roomState={roomState} target={itemVoteTarget(item.id)} participantId={participantId} send={send} label={item.text} />
        {isOwner && (
          <div className="item-card__actions" aria-label={`Actions for ${item.text}`}>
            <Button type="button" variant="ghost" size="sm" onClick={() => onStartEdit(item)} disabled={pendingItemId === item.id}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="item-card__delete"
              onClick={() => onDeleteItem(item.id)}
              disabled={pendingItemId === item.id}
              aria-busy={pendingItemId === item.id}
            >
              {pendingItemId === item.id ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Delete
            </Button>
          </div>
        )}
      </li>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="write-empty-state empty-state" role="status" aria-live="polite">
        <div className="empty-state__icon empty-state__icon--block" aria-hidden="true">
          <Columns3 size={28} />
        </div>
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
        const inputValue = columnInputs[column.id] ?? "";
        const columnError = columnErrors[column.id];
        const composerId = `write-card-input-${column.id}`;
        const errorId = `write-card-error-${column.id}`;
        const isPending = pendingColumnId === column.id;
        const isNearLimit = inputValue.length > 400;
        return (
          <Card key={column.id} className="column-board__column" role="region" aria-labelledby={`write-column-${column.id}`} data-column-id={column.id}>
              <CardHeader className="column-board__header px-0">
                <CardTitle id={`write-column-${column.id}`} role="heading" aria-level={3} className="column-board__title" title={column.name}>{column.name}</CardTitle>
                <Badge variant="secondary" className="column-board__count" aria-label={`${items.length} items`}>{items.length}</Badge>
              </CardHeader>
              <CardContent className="px-0">
                <form className="write-card-composer" onSubmit={(event) => onAddItem(event, column.id)} aria-label={`Add card to ${column.name}`}>
                  <label className="sr-only" htmlFor={composerId}>Add a card to {column.name}</label>
                  <textarea
                    ref={(element) => {
                      columnInputRefs.current[column.id] = element;
                    }}
                    id={composerId}
                    className={`input write-card-composer__textarea${columnError ? " input--error" : ""}`}
                    value={inputValue}
                    onChange={(event) => onColumnInputChange(column.id, event.target.value)}
                    onKeyDown={submitFormOnModEnter}
                    maxLength={500}
                    rows={3}
                    placeholder={`Write a ${column.name} card…`}
                    aria-describedby={[columnError ? errorId : "", isNearLimit ? `${composerId}-count` : ""].filter(Boolean).join(" ") || undefined}
                    aria-invalid={columnError ? "true" : undefined}
                    disabled={isPending}
                  />
                  <div className="write-card-composer__footer">
                    <span id={`${composerId}-count`} className="write-card-composer__count" aria-live="polite">
                      {isNearLimit ? `${inputValue.length}/500` : connected ? "Visible to the room after adding" : "Reconnect to add"}
                    </span>
                    <Button
                      type="submit"
                      size="sm"
                      className="write-card-composer__submit"
                      disabled={isPending || !connected || !inputValue.trim()}
                      aria-busy={isPending}
                    >
                      {isPending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                      Add card
                    </Button>
                  </div>
                  {columnError && (
                    <div id={errorId} className="status-msg status-msg--error write-card-composer__error" role="alert">
                      {columnError}
                    </div>
                  )}
                </form>
                {items.length === 0 ? (
                  <p className="text-muted column-board__empty">No cards in this lane yet. Add one directly above.</p>
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
  const [participantId, setParticipantId] = useState(() => identity.participantId);
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [roomLoadError, setRoomLoadError] = useState<RoomLoadError | null>(null);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => identity.connectionToken);
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [voteBudgetDirty, setVoteBudgetDirty] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [timerInputError, setTimerInputError] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);
  const [rankingMsg, setRankingMsg] = useState<string | null>(null);
  const [budgetPending, setBudgetPending] = useState(false);
  const [rankingPending, setRankingPending] = useState(false);
  const [phasePending, setPhasePending] = useState(false);
  const [timerPending, setTimerPending] = useState(false);
  const [purgePending, setPurgePending] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [pendingColumnId, setPendingColumnId] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const phaseStatusRef = useRef<HTMLDivElement>(null);
  const previousRoomUpdateRef = useRef<{ phase: Phase; version: number } | null>(null);
  const initialLoadStartedRef = useRef(false);
  const lastAuthoritativeVoteBudgetRef = useRef<number | null>(null);

  const { state: wsState, connected, lastError, roomPurged, clearError, send } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);

  const [columnInputs, setColumnInputs] = useState<Record<string, string>>({});
  const [columnErrors, setColumnErrors] = useState<Record<string, string | undefined>>({});
  const columnInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const restoreColumnFocusRef = useRef<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState("");
  const sortedRoomColumns = roomState ? getSortedColumns(roomState) : [];
  const currentPhaseIndex = roomState ? PHASE_ORDER.indexOf(roomState.phase) : -1;
  const nextPhase = currentPhaseIndex >= 0 ? PHASE_ORDER[currentPhaseIndex + 1] : undefined;

  const resetStoredIdentity = useCallback(() => {
    if (!roomId) return;
    const nextParticipantId = crypto.randomUUID();
    localStorage.setItem(`retro-participant-${roomId}`, nextParticipantId);
    localStorage.removeItem(`retro-token-${roomId}`);
    setParticipantId(nextParticipantId);
    setConnectionToken(undefined);
  }, [roomId]);

  useEffect(() => {
    if (!roomPurged) return undefined;
    const timeout = window.setTimeout(() => {
      if (roomId) clearStoredIdentity(roomId);
      setLocalRoomState(null);
      setPageState("not-found");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [roomId, roomPurged]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimerPending(false), 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.timer.startedAt, roomState?.timer.durationSeconds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPhaseMsg(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.phase]);

  useEffect(() => {
    if (!roomState) return undefined;
    const nextBudget = roomState.voteBudget;
    const previousBudget = lastAuthoritativeVoteBudgetRef.current;
    if (previousBudget === nextBudget) return undefined;

    lastAuthoritativeVoteBudgetRef.current = nextBudget;
    const nextBudgetInput = String(nextBudget);
    if (!voteBudgetDirty || voteBudgetInput === nextBudgetInput || budgetPending) {
      const timeout = window.setTimeout(() => {
        setVoteBudgetInput(nextBudgetInput);
        setVoteBudgetDirty(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [budgetPending, roomState, roomState?.voteBudget, voteBudgetDirty, voteBudgetInput]);

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
    if (!identity.displayName || !identity.connectionToken) {
      setPageState("join");
      return;
    }
    try {
      const result = await joinRoom(roomId, participantId, identity.displayName, identity.connectionToken, getFacilitatorClaimToken(roomId));
      if (!result.success) {
        resetStoredIdentity();
        setPageState("join");
        return;
      }
      localStorage.setItem(`retro-name-${roomId}`, identity.displayName);
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
        setConnectionToken(result.connectionToken);
      }
      setPageState("room");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        clearStoredIdentity(roomId);
        setPageState("not-found");
        return;
      }
      setRoomLoadError(classifyRoomLoadError(error));
      setPageState("load-error");
    }
  }, [roomId, participantId, identity.displayName, identity.connectionToken, resetStoredIdentity]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return undefined;
    const timeout = window.setTimeout(() => {
      if (initialLoadStartedRef.current) return;
      initialLoadStartedRef.current = true;
      void loadInitialRoom();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadInitialRoom]);

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
      const result = await joinRoom(roomId, participantId, trimmed, connectionToken, getFacilitatorClaimToken(roomId));
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
      sessionStorage.removeItem(`retro-facilitator-claim-${roomId}`);
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
    const rawBudget = voteBudgetInput.trim();
    const budget = Number(rawBudget);
    if (!/^\d+$/.test(rawBudget) || !Number.isInteger(budget) || budget < 1 || budget > 100) {
      setBudgetMsg("Vote budget must be an integer between 1 and 100.");
      return;
    }
    setBudgetPending(true);
    try {
      const result = await setVoteBudget(roomId, participantId, connectionToken, budget);
      if (result.success) {
        setBudgetMsg("Vote budget updated.");
        setVoteBudgetInput(String(budget));
        setVoteBudgetDirty(false);
        // Refetch authoritative state to handle any missed WebSocket broadcasts during reconnect
        try {
          const state = await getRoomState(roomId, participantId, connectionToken);
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

  async function handleSetRankingMethod(rankingMethod: RankingMethod) {
    if (!roomId || !roomState || rankingPending || roomState.rankingMethod === rankingMethod) return;
    setRankingMsg(null);
    clearError();
    setRankingPending(true);
    try {
      const result = await setRankingMethod(roomId, participantId, connectionToken, rankingMethod);
      if (result.success) {
        setRankingMsg(rankingMethod === "pairwise" ? "Pairwise ranking selected." : "Score voting selected.");
        try {
          const state = await getRoomState(roomId, participantId, connectionToken);
          setLocalRoomState(state);
        } catch {
          // WebSocket snapshot will reconcile if the refetch misses.
        }
      } else {
        setRankingMsg(result.error ?? "Failed to update ranking method.");
      }
    } finally {
      setRankingPending(false);
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
      const result = await setPhase(roomId, participantId, connectionToken, nextPhase);
      if (result.success) {
        setPhaseMsg(`Advanced to ${nextPhase}.`);
        window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
        // Refetch authoritative state so the UI updates even if the WebSocket broadcast
        // was missed during a post-reload reconnect window
        try {
          const state = await getRoomState(roomId, participantId, connectionToken);
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

  async function handleSetTimer() {
    if (!roomId || !roomState || timerPending) return;
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
    setTimerPending(true);
    try {
      const result = await setTimer(roomId, participantId, connectionToken, durationSeconds);
      if (!result.success) {
        setTimerInputError(result.error ?? "Failed to start timer.");
        return;
      }
      setTimerMsg("Timer started.");
      try {
        const state = await getRoomState(roomId, participantId, connectionToken);
        setLocalRoomState(state);
      } catch {
        // WebSocket snapshot will reconcile if refetch misses.
      }
    } catch {
      setTimerInputError("Failed to start timer. Check the room connection and try again.");
    } finally {
      setTimerPending(false);
    }
  }

  async function handlePurgeRoom() {
    if (!roomId || purgePending) return;
    const confirmed = window.confirm("Delete this room and scrub all retro data now? This cannot be undone.");
    if (!confirmed) return;

    setPurgeMsg(null);
    setPurgePending(true);
    try {
      const result = await purgeRoom(roomId, participantId, connectionToken);
      if (!result.success) {
        setPurgeMsg(result.error ?? "Failed to delete room data.");
        return;
      }
      clearStoredIdentity(roomId);
      setLocalRoomState(null);
      setPageState("not-found");
    } catch {
      setPurgeMsg("Failed to delete room data. Check the room connection and try again.");
    } finally {
      setPurgePending(false);
    }
  }

  function handleColumnInputChange(columnId: string, value: string) {
    setColumnInputs((current) => ({ ...current, [columnId]: value }));
    setColumnErrors((current) => ({ ...current, [columnId]: undefined }));
  }

  async function handleAddItem(e: React.FormEvent, columnId: string) {
    e.preventDefault();
    if (!roomId || pendingColumnId) return;
    const rawText = columnInputs[columnId] ?? "";
    setColumnErrors((current) => ({ ...current, [columnId]: undefined }));
    if (!isValidItemText(rawText)) {
      setColumnErrors((current) => ({ ...current, [columnId]: "Card text cannot be blank." }));
      return;
    }
    if (!sortedRoomColumns.some((column) => column.id === columnId)) {
      setColumnErrors((current) => ({ ...current, [columnId]: "Column not found." }));
      return;
    }
    const nextText = sanitizeItemText(rawText);
    setPendingColumnId(columnId);
    try {
      const result = await addItem(roomId, participantId, connectionToken, nextText, columnId);
      if (!result.success) {
        setColumnErrors((current) => ({ ...current, [columnId]: result.error ?? "Failed to add card." }));
        return;
      }
      setColumnInputs((current) => ({ ...current, [columnId]: "" }));
      restoreColumnFocusRef.current = columnId;
      setPendingColumnId(null);
      try {
        const state = await getRoomState(roomId, participantId, connectionToken);
        setLocalRoomState(state);
      } catch {
        if (result.item && roomState) {
          setLocalRoomState({ ...roomState, items: [...roomState.items, result.item], version: roomState.version + 1 });
        }
      }
    } catch {
      setColumnErrors((current) => ({ ...current, [columnId]: "Failed to add card. Check the room connection and try again." }));
    } finally {
      setPendingColumnId(null);
    }
  }

  useEffect(() => {
    const columnId = restoreColumnFocusRef.current;
    if (!columnId || pendingColumnId !== null) return;
    restoreColumnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      columnInputRefs.current[columnId]?.focus();
    });
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

  async function handleSubmitEditItem(e: React.FormEvent, itemId: string) {
    e.preventDefault();
    if (!roomId || pendingItemId) return;
    if (!isValidItemText(editingItemText)) return;
    setColumnErrors((current) => ({ ...current, __global: undefined }));
    const nextText = sanitizeItemText(editingItemText);
    setPendingItemId(itemId);
    try {
      const result = await editItem(roomId, participantId, connectionToken, itemId, nextText);
      if (!result.success) {
        setColumnErrors((current) => ({ ...current, __global: result.error ?? "Failed to edit card." }));
        return;
      }
      setEditingItemId(null);
      setEditingItemText("");
      try {
        const state = await getRoomState(roomId, participantId, connectionToken);
        setLocalRoomState(state);
      } catch {
        if (result.item && roomState) {
          setLocalRoomState({
            ...roomState,
            items: roomState.items.map((item) => item.id === itemId ? result.item! : item),
            version: roomState.version + 1,
          });
        }
      }
    } catch {
      setColumnErrors((current) => ({ ...current, __global: "Failed to edit card. Check the room connection and try again." }));
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!roomId || pendingItemId) return;
    setColumnErrors((current) => ({ ...current, __global: undefined }));
    setPendingItemId(itemId);
    try {
      const result = await deleteItem(roomId, participantId, connectionToken, itemId);
      if (!result.success) {
        setColumnErrors((current) => ({ ...current, __global: result.error ?? "Failed to delete card." }));
        return;
      }
      if (editingItemId === itemId) handleCancelEditItem();
      try {
        const state = await getRoomState(roomId, participantId, connectionToken);
        setLocalRoomState(state);
      } catch {
        if (roomState) {
          setLocalRoomState({
            ...roomState,
            items: roomState.items.filter((item) => item.id !== itemId),
            version: roomState.version + 1,
          });
        }
      }
    } catch {
      setColumnErrors((current) => ({ ...current, __global: "Failed to delete card. Check the room connection and try again." }));
    } finally {
      setPendingItemId(null);
    }
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
        <Card className="state-card join-card join-card--room">
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
                  Display name
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
                  onKeyDown={submitFormOnModEnter}
                  maxLength={50}
                  placeholder="Alex"
                  autoComplete="nickname"
                  aria-required="true"
                  aria-describedby={joinError ? "join-error" : undefined}
                  aria-invalid={joinError ? "true" : undefined}
                />
              </div>
              <Button
                type="submit"
                className="join-card__submit"
                disabled={joinLoading}
                aria-busy={joinLoading}
              >
                {joinLoading ? (
                  <>
                    <Loader2 className="loading-spinner" aria-hidden="true" />
                    Joining…
                  </>
                ) : "Join room"}
              </Button>
              <p className="join-card__privacy">
                Your reconnect token stays in this browser. The invite link does not include participant credentials.
              </p>
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
          <div className="room-header__brand" aria-hidden="true">RB</div>
          <div>
            <h1 className="room-header__title">Retro Board</h1>
            <p className="room-header__subtitle">Timed team retrospective</p>
          </div>
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

      {roomState && (
        <PhaseProgress phase={roomState.phase} startedAt={roomState.startedAt} />
      )}

      {/* Phase Status Bar */}
      <Card ref={phaseStatusRef} className="phase-status" role="region" aria-label="Room status" tabIndex={-1}>
        <div className="phase-status__metric">
          <span className="phase-status__label">Current phase</span>
          <Badge className="phase-status__value badge--phase" data-phase={roomState?.phase ?? "unknown"}>
            {roomState ? PHASE_LABELS[roomState.phase] : "Unknown"}
          </Badge>
        </div>
        <div className="phase-status__metric">
          <span className="phase-status__label">Timer</span>
          <TimerDisplay timer={roomState?.timer ?? { startedAt: null, durationSeconds: null, expired: false }} />
        </div>
        <div className="phase-status__metric">
          <span className="phase-status__label">Board</span>
          <span className="phase-status__meta">{sortedRoomColumns.length} columns · {roomState?.items.length ?? 0} items</span>
        </div>
      </Card>

      {/* Participants */}
      <section
        className="participants-bar"
        role="region"
        aria-label="Participants"
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
            <div className="facilitator-panel__heading">
              <CardTitle className="facilitator-panel__title">
                <ShieldCheck aria-hidden="true" size={14} />
                Facilitator controls
              </CardTitle>
              <CardDescription>
                Run the retro without exposing participant credentials.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="facilitator-panel__controls px-0">
            {roomState?.rankingMethod !== "pairwise" && roomState?.phase === "setup" && (
            <div className="facilitator-panel__row">
              <label className="input-label" htmlFor="voteBudget">
                <Vote aria-hidden="true" size={14} />
                Vote Budget
              </label>
              <Input
                id="voteBudget"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={voteBudgetInput}
                onChange={(e) => {
                  setVoteBudgetInput(e.target.value);
                  setVoteBudgetDirty(true);
                  if (budgetMsg) setBudgetMsg(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleSetBudget();
                  }
                }}
                className={`input facilitator-panel__number-input${budgetMsg && budgetMsg.includes("must be") ? " input--error" : ""}`}
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
                <span id="budget-error" className="status-msg status-msg--error facilitator-panel__message" role="alert">
                  {budgetMsg}
                </span>
              ) : budgetMsg ? (
                <span className="status-msg status-msg--info facilitator-panel__message" role="status">
                  {budgetMsg}
                </span>
              ) : null}
            </div>
            )}
            <div className="facilitator-panel__row">
              <Button
                onClick={handleAdvancePhase}
                disabled={roomState?.phase === "finalize" || phasePending}
                aria-busy={phasePending}
                aria-label={nextPhase ? `Advance to ${PHASE_LABELS[nextPhase]} phase` : "Advance phase"}
              >
                {phasePending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                {phasePending ? "Advancing…" : nextPhase ? `Advance to ${PHASE_LABELS[nextPhase]}` : "Complete"}
              </Button>
              {phaseMsg && (
                <span className="status-msg status-msg--info facilitator-panel__message" role="status">
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
                type="number"
                min={1}
                max={60}
                value={timerMinutesInput}
                onChange={(e) => {
                  setTimerMinutesInput(e.target.value);
                  if (timerInputError) setTimerInputError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleSetTimer();
                  }
                }}
                className={`input facilitator-panel__number-input${timerInputError ? " input--error" : ""}`}
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
                <span id="timer-error" className="status-msg status-msg--error facilitator-panel__message" role="alert">
                  {timerInputError}
                </span>
              )}
              {timerMsg && !timerInputError && (
                <span className="status-msg status-msg--info facilitator-panel__message" role="status">
                  {timerMsg}
                </span>
              )}
            </div>
            <div className="facilitator-panel__row facilitator-panel__row--danger">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="room-delete-button"
                onClick={handlePurgeRoom}
                disabled={purgePending}
                aria-busy={purgePending}
              >
                {purgePending ? <Loader2 className="loading-spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                {purgePending ? "Deleting…" : "Delete room data"}
              </Button>
              <span className="facilitator-panel__message text-muted">
                Rooms also auto-delete one hour after the last active participant leaves.
              </span>
              {purgeMsg && (
                <span className="status-msg status-msg--error facilitator-panel__message" role="alert">
                  {purgeMsg}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Board Area */}
      <Card className="board-area glass-panel">
        <div className="board-header">
          <div>
            <h2 className="board-title">
              <Columns3 aria-hidden="true" size={18} />
              Board
            </h2>
            <p className="board-subtitle">Capture, sort, vote, and review feedback in one shared room.</p>
          </div>
          {roomState?.phase === "setup" && (
            <span className="phase-hint" aria-hidden="true">
              {isFacilitator ? "Configure once, then lock" : "Waiting for facilitator"}
            </span>
          )}
          {roomState?.phase === "write" && (
            <span className="phase-hint" aria-hidden="true">Write privately, discuss together</span>
          )}
        </div>

        {roomState?.phase === "write" && columnErrors.__global && (
          <div className="status-msg status-msg--error write-global-error" role="alert">
            {columnErrors.__global}
          </div>
        )}

        {roomState?.phase === "setup" ? (
          <SetupBoard
            roomState={roomState}
            isFacilitator={isFacilitator}
            send={send}
            serverError={lastError}
            clearServerError={clearError}
            onRankingMethodChange={handleSetRankingMethod}
            rankingPending={rankingPending}
            rankingMsg={rankingMsg}
          />
        ) : roomState?.phase === "organise" ? (
          <OrganiseBoard
            roomState={roomState}
            isFacilitator={isFacilitator}
            participantId={participantId}
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
          <ReviewBoard
            roomState={roomState}
            participantId={participantId}
            isFacilitator={isFacilitator}
            send={send}
            serverError={lastError}
            clearServerError={clearError}
          />
        ) : roomState?.phase === "finalize" ? (
          <FinalBoard roomState={roomState} />
        ) : roomState?.phase === "write" ? (
          <WriteColumnBoard
            roomState={roomState}
            participantId={participantId}
            connected={connected}
            columnInputs={columnInputs}
            columnErrors={columnErrors}
            pendingColumnId={pendingColumnId}
            editingItemId={editingItemId}
            editingItemText={editingItemText}
            pendingItemId={pendingItemId}
            onColumnInputChange={handleColumnInputChange}
            onAddItem={handleAddItem}
            onStartEdit={handleStartEditItem}
            onEditTextChange={setEditingItemText}
            onSubmitEdit={handleSubmitEditItem}
            onCancelEdit={handleCancelEditItem}
            onDeleteItem={handleDeleteItem}
            send={send}
            columnInputRefs={columnInputRefs}
          />
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
