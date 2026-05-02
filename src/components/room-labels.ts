import type { Phase } from "../domain";

export const PHASE_LABELS: Record<Phase, string> = {
  setup: "Setup",
  write: "Write",
  organise: "Organise",
  vote: "Vote",
  review: "Review",
  finalize: "Finalize",
};
