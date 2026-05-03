import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock3,
  Columns3,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { Column, RankingMethod, RoomState } from "../domain";
import { MAX_COLUMNS, MAX_COLUMN_NAME_LENGTH } from "../domain";
import { submitFormOnModEnter } from "./form-shortcuts";
import { getSortedColumns } from "./room-columns";
import {
  buildColumnCreateCommandEffect,
  buildColumnDeleteCommandEffect,
  buildColumnEditCommandEffect,
  buildColumnReorderCommandEffect,
} from "./setup-board-effect";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type SetupBoardProps = {
  roomState: RoomState;
  isFacilitator: boolean;
  send: (message: unknown) => boolean;
  serverError: string | null;
  clearServerError: () => void;
  onRankingMethodChange: (rankingMethod: RankingMethod) => void;
  rankingPending: boolean;
  rankingMsg: string | null;
};

type ColumnConfigurationProps = Pick<
  SetupBoardProps,
  "roomState" | "send" | "serverError" | "clearServerError"
>;

function ColumnConfiguration({
  roomState,
  send,
  serverError,
  clearServerError,
}: ColumnConfigurationProps) {
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
  const displayedError =
    columnError ??
    (serverError && /column/i.test(serverError) ? serverError : null);

  useEffect(() => {
    if (
      pendingColumnMutation &&
      pendingColumnVersionRef.current !== roomState.version
    ) {
      pendingColumnVersionRef.current = null;
      setPendingColumnMutation(false);
      setColumnMsg(null);
    }
  }, [pendingColumnMutation, roomState.version]);

  useEffect(() => {
    if (!displayedError) return undefined;
    const timeout = window.setTimeout(() => {
      pendingColumnVersionRef.current = null;
      setPendingColumnMutation(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [displayedError]);

  function clearFeedback() {
    setColumnMsg(null);
    setColumnError(null);
    clearServerError();
  }

  function handleCreateColumn(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();
    const command = Effect.runSync(
      buildColumnCreateCommandEffect({
        phase: roomState.phase,
        isAtMax,
        rawName: newColumnName,
      }),
    );
    if (!command.success) return setColumnError(command.error);
    if (!send(command.message)) {
      return setColumnError(
        "Reconnecting. Please try again once the room is connected.",
      );
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setNewColumnName("");
    setColumnMsg("Column creation sent.");
  }

  function submitEdit(columnId: string) {
    clearFeedback();
    const command = Effect.runSync(
      buildColumnEditCommandEffect(columnId, editingName),
    );
    if (!command.success) return setColumnError(command.error);
    if (!send(command.message)) {
      return setColumnError(
        "Reconnecting. Please try again once the room is connected.",
      );
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setEditingColumnId(null);
    setEditingName("");
    setColumnMsg("Column rename sent.");
  }

  function moveColumn(fromIdx: number, toIdx: number) {
    clearFeedback();
    const command = Effect.runSync(
      buildColumnReorderCommandEffect(columns, fromIdx, toIdx),
    );
    if (!command.success) {
      if (command.error) setColumnError(command.error);
      return;
    }
    if (!send(command.message)) {
      return setColumnError(
        "Reconnecting. Please try again once the room is connected.",
      );
    }
    pendingColumnVersionRef.current = roomState.version;
    setPendingColumnMutation(true);
    setColumnMsg("Column reorder sent.");
  }

  function deleteColumn(column: Column) {
    clearFeedback();
    const command = Effect.runSync(
      buildColumnDeleteCommandEffect(column.id, roomState.phase),
    );
    if (!command.success) return setColumnError(command.error);
    if (!send(command.message)) {
      return setColumnError(
        "Reconnecting. Please try again once the room is connected.",
      );
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
                Facilitators configure columns during setup. They lock before
                writing starts so later votes and exports stay consistent.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="column-config__count">
              {columns.length}/{MAX_COLUMNS}
            </Badge>
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
              {pendingColumnMutation ? (
                <Loader2 className="loading-spinner" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
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
                <span
                  className="column-config__order"
                  aria-label={`Column order ${index + 1}`}
                >
                  {index + 1}
                </span>
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
                  <span className="column-config__name" title={column.name}>
                    {column.name}
                  </span>
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
                        {pendingColumnMutation ? (
                          <Loader2
                            className="loading-spinner"
                            aria-hidden="true"
                          />
                        ) : (
                          <Save aria-hidden="true" />
                        )}
                        {pendingColumnMutation ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="reorder-btn"
                        onClick={() => setEditingColumnId(null)}
                        aria-label="Cancel column edit"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        clearFeedback();
                        setEditingColumnId(column.id);
                        setEditingName(column.name);
                      }}
                      disabled={!canMutate || pendingColumnMutation}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="reorder-btn"
                    onClick={() => moveColumn(index, index - 1)}
                    disabled={
                      !canMutate || pendingColumnMutation || index === 0
                    }
                    aria-label={`Move ${column.name} column left`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="reorder-btn"
                    onClick={() => moveColumn(index, index + 1)}
                    disabled={
                      !canMutate ||
                      pendingColumnMutation ||
                      index === columns.length - 1
                    }
                    aria-label={`Move ${column.name} column right`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="reorder-btn reorder-btn--danger"
                    onClick={() => deleteColumn(column)}
                    disabled={!canMutate || pendingColumnMutation}
                    aria-label={`Delete ${column.name} column`}
                  >
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

export function SetupBoard(props: SetupBoardProps) {
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
      description:
        "Each participant gets a small vote budget and spends points on the most important items within the vote board.",
    },
    {
      id: "pairwise",
      title: "Pairwise ranking",
      eyebrow: "Small groups",
      description:
        "Participants choose between two items at a time inside each column. Results rank by comparison wins.",
    },
  ];

  if (!props.isFacilitator) {
    return (
      <div
        className="setup-board setup-board--waiting"
        aria-label="Waiting for setup"
      >
        <section className="setup-panel setup-panel--waiting">
          <div className="setup-waiting__icon" aria-hidden="true">
            <Clock3 size={18} />
          </div>
          <div>
            <p className="review-slide__eyebrow">Setup in progress</p>
            <h3>Waiting for the facilitator</h3>
            <p className="setup-panel__copy">
              The facilitator is choosing the room settings. You will move into
              writing automatically when setup is complete.
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
          Choose the board columns and the decision method before participants
          start writing. This keeps later grouping, ranking, review, and exports
          stable.
        </p>
        <div
          className="ranking-method-grid"
          role="radiogroup"
          aria-label="Ranking method"
        >
          {methods.map((method) => (
            <button
              key={method.id}
              type="button"
              className={`ranking-method-card${props.roomState.rankingMethod === method.id ? " ranking-method-card--selected" : ""}`}
              onClick={() => props.onRankingMethodChange(method.id)}
              disabled={props.rankingPending}
              role="radio"
              aria-checked={props.roomState.rankingMethod === method.id}
            >
              <span className="ranking-method-card__eyebrow">
                {method.eyebrow}
              </span>
              <span className="ranking-method-card__title">{method.title}</span>
              <span className="ranking-method-card__description">
                {method.description}
              </span>
            </button>
          ))}
        </div>
        {props.rankingMsg && (
          <div
            className={`status-msg ${props.rankingMsg.includes("Failed") || props.rankingMsg.includes("only") ? "status-msg--error" : "status-msg--info"}`}
            role="status"
          >
            {props.rankingMsg}
          </div>
        )}
      </section>

      <ColumnConfiguration
        roomState={props.roomState}
        send={props.send}
        serverError={props.serverError}
        clearServerError={props.clearServerError}
      />
    </div>
  );
}
