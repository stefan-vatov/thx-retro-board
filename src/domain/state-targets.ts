import type { VoteAllocation, VoteTarget } from "./types";

export function voteTargetKey(target: VoteTarget): string {
  return `${target.type}:${target.id}`;
}

export function pairwiseComparisonKey(left: VoteTarget, right: VoteTarget): string {
  return [voteTargetKey(left), voteTargetKey(right)].sort().join("::");
}

export function groupVoteTarget(groupId: string): VoteTarget {
  return { type: "group", id: groupId };
}

export function itemVoteTarget(itemId: string): VoteTarget {
  return { type: "item", id: itemId };
}

export function getVoteTarget(vote: VoteAllocation): VoteTarget | null {
  if (
    vote.target
    && (vote.target.type === "group" || vote.target.type === "item")
    && typeof vote.target.id === "string"
  ) {
    return vote.target;
  }
  if (typeof vote.groupId === "string") {
    return groupVoteTarget(vote.groupId);
  }
  if (typeof vote.itemId === "string") {
    return groupVoteTarget(vote.itemId);
  }
  return null;
}

export function sameVoteTarget(left: VoteTarget, right: VoteTarget): boolean {
  return left.type === right.type && left.id === right.id;
}
