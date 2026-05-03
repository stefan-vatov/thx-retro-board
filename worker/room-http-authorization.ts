import { Effect } from "effect";

import type { RoomHttpController } from "./room-http";

type RoomMutationResult<T extends object = object> = { success: boolean; error?: string } & T;
type RoomAuthorizationResult = Awaited<ReturnType<RoomHttpController["authorizeHttpParticipant"]>>;

export interface RoomHttpAuthorizationDeps {
  authorizeParticipant: (
    room: RoomHttpController,
    participantId: string,
    connectionToken: unknown,
  ) => Effect.Effect<RoomAuthorizationResult>;
  runMutation: <T extends object>(
    mutation: (participantId: string) => Promise<RoomMutationResult<T>>,
    participantId: string,
  ) => Effect.Effect<RoomMutationResult<T>>;
}

export const roomHttpAuthorizationDeps: RoomHttpAuthorizationDeps = {
  authorizeParticipant: (room, participantId, connectionToken) =>
    Effect.promise(() => room.authorizeHttpParticipant(participantId, connectionToken)),
  runMutation: (mutation, participantId) => Effect.promise(() => mutation(participantId)),
};

export function runAuthorizedRoomMutationEffect<T extends object>(
  room: RoomHttpController,
  participantId: string,
  connectionToken: unknown,
  mutation: (participantId: string) => Promise<RoomMutationResult<T>>,
  deps: Partial<RoomHttpAuthorizationDeps> = {},
): Effect.Effect<Response> {
  return Effect.gen(function* () {
    const d = { ...roomHttpAuthorizationDeps, ...deps };
    const auth = yield* d.authorizeParticipant(room, participantId, connectionToken);
    if (!auth.success) return Response.json(auth, { status: 403 });

    const result = yield* d.runMutation(mutation, auth.participantId);
    return Response.json(result);
  });
}
