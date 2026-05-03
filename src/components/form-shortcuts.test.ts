import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { submitFormOnModEnter, submitFormOnModEnterEffect } from "./form-shortcuts";

function createKeyboardEvent(options: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
  const requestSubmit = vi.fn();
  const preventDefault = vi.fn();
  return {
    event: {
      key: options.key,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      preventDefault,
      currentTarget: {
        closest: () => ({ requestSubmit }),
      },
    },
    preventDefault,
    requestSubmit,
  };
}

describe("form shortcuts", () => {
  it("submits the nearest form on cmd/ctrl enter", () => {
    const { event, preventDefault, requestSubmit } = createKeyboardEvent({ key: "Enter", metaKey: true });

    submitFormOnModEnter(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("ignores plain enter", () => {
    const { event, preventDefault, requestSubmit } = createKeyboardEvent({ key: "Enter" });

    submitFormOnModEnter(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("submits the nearest form through Effect", async () => {
    const { event, preventDefault, requestSubmit } = createKeyboardEvent({ key: "Enter", ctrlKey: true });

    await Effect.runPromise(submitFormOnModEnterEffect(event));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledOnce();
  });
});
