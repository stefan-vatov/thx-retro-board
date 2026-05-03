import { Effect } from "effect";

export type FocusableElement = {
  focus(): void;
};

export type FocusRestoreInput = {
  target: FocusableElement | null | undefined;
  activeElement: Element | FocusableElement | null | undefined;
};

export type FocusRestoreSchedule = {
  restore(): void;
  delays: number[];
  requestAnimationFrame(callback: () => void): unknown;
  setTimeout(callback: () => void, delay: number): unknown;
};

export function isEditableElementEffect(
  element: Element | null | undefined,
): Effect.Effect<boolean> {
  return Effect.sync(() => {
    const activeTag = element?.tagName.toLowerCase();
    return (
      activeTag === "input" ||
      activeTag === "textarea" ||
      activeTag === "select" ||
      element?.getAttribute("contenteditable") === "true"
    );
  });
}

export function restoreFocusEffect({
  target,
  activeElement,
}: FocusRestoreInput): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!target) return;
    const activeIsEditable =
      activeElement && "tagName" in activeElement
        ? yield* isEditableElementEffect(activeElement)
        : false;
    if (activeIsEditable && activeElement !== target) return;
    target.focus();
  });
}

export function scheduleFocusRestoreEffect({
  restore,
  delays,
  requestAnimationFrame,
  setTimeout,
}: FocusRestoreSchedule): Effect.Effect<void> {
  return Effect.sync(() => {
    requestAnimationFrame(restore);
    for (const delay of delays) {
      setTimeout(restore, delay);
    }
  });
}
