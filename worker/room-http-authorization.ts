import { Effect } from "effect";

import type { RoomHttpController } from "./room-http";

type RoomMutationResult<T extends object = object> = { success: boolean; error?: string } & T;

export function runAuthorizedRoomMutationEffect<T extends object>(
  room: RoomHttpController,
  participantId: string,
  connectionToken: unknown,
  mutation: (participantId: string) => Promise<RoomMutationResult<T>>,
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const auth = yield* Effect.promise(() => room.authorizeHttpParticipant(participantId, connectionToken));
    if (!auth.success) return Response.json(auth, { status: 403 });

    const result = yield* Effect.promise(() => mutation(auth.participantId));
    return Response.json(result);
  });
}
