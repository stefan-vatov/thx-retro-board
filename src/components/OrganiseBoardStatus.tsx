import { AlertCircle, Columns3, GripVertical } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

type DragPosition = {
  x: number;
  y: number;
};

type OrganiseBoardStatusProps = {
  draggingItemId: string | null;
  draggingItemText: string;
  dragPosition: DragPosition | null;
  organiseActionError: string | null;
  serverOrganiseError: string | null;
  feedbackMessages: string[];
  showEmptyColumns: boolean;
};

export function OrganiseBoardStatus({
  draggingItemId,
  draggingItemText,
  dragPosition,
  organiseActionError,
  serverOrganiseError,
  feedbackMessages,
  showEmptyColumns,
}: OrganiseBoardStatusProps) {
  return (
    <>
      {draggingItemId && (
        <Alert
          className="status-msg status-msg--info drag-status"
          role="status"
          aria-live="polite"
        >
          <GripVertical aria-hidden="true" />
          <AlertTitle>Dragging item</AlertTitle>
          <AlertDescription>
            Drop anywhere in a group or ungrouped area in the same column, or
            press Escape to cancel.
          </AlertDescription>
        </Alert>
      )}

      {draggingItemId && dragPosition && (
        <div
          className="drag-preview"
          style={{
            transform: `translate3d(${dragPosition.x + 14}px, ${dragPosition.y + 14}px, 0)`,
          }}
          aria-hidden="true"
        >
          <GripVertical size={16} />
          <span>{draggingItemText}</span>
        </div>
      )}

      {(organiseActionError || serverOrganiseError) && (
        <Alert
          variant="destructive"
          className="status-msg status-msg--error organise-error"
        >
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Organise change was not applied</AlertTitle>
          <AlertDescription>
            {organiseActionError ?? serverOrganiseError}
          </AlertDescription>
        </Alert>
      )}

      {feedbackMessages.length > 0 && !organiseActionError && (
        <div id="organise-group-feedback" className="organise-feedback-stack">
          {feedbackMessages.map((message) => (
            <Alert
              key={message}
              variant="destructive"
              className="status-msg status-msg--error organise-feedback-alert"
            >
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {showEmptyColumns && (
        <div className="empty-state">
          <div
            className="empty-state__icon empty-state__icon--block"
            aria-hidden="true"
          >
            <Columns3 size={28} />
          </div>
          <p className="empty-state__text">
            No columns to organise yet. Ask the facilitator to create columns.
          </p>
        </div>
      )}
    </>
  );
}
