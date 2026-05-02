import { Effect, Schema } from "effect";

export const validJsonBodyError = {
  success: false,
  error: "Valid JSON body is required",
} as const;

export interface JsonBodyOptions {
  maxBytes: number;
}

export function readJsonBodyEffect<T>(
  request: Request,
  options: JsonBodyOptions,
): Effect.Effect<T | null> {
  return Effect.promise(async () => {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) return null;

    const contentLength = request.headers.get("Content-Length");
    if (contentLength !== null && (!Number.isFinite(Number(contentLength)) || Number(contentLength) > options.maxBytes)) {
      return null;
    }

    const rawBody = await readBoundedRequestBody(request, options.maxBytes);
    if (rawBody === null) return null;

    try {
      return JSON.parse(rawBody) as T;
    } catch {
      return null;
    }
  });
}

export function readJsonBody<T>(
  request: Request,
  options: JsonBodyOptions,
): Promise<T | null> {
  return Effect.runPromise(readJsonBodyEffect<T>(request, options));
}

export async function readValidatedJsonBody<T>(
  request: Request,
  schema: Schema.Schema<T>,
  options: JsonBodyOptions,
): Promise<T | Response> {
  const body = await readJsonBody<unknown>(request, options);
  if (body === null) return Response.json(validJsonBodyError, { status: 400 });

  const decoded = await Effect.runPromiseExit(Schema.decodeUnknown(schema)(body));
  return decoded._tag === "Success"
    ? decoded.value
    : Response.json(validJsonBodyError, { status: 400 });
}

async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";

  if (!reader) {
    body = await request.text();
    return new TextEncoder().encode(body).byteLength > maxBytes ? null : body;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}
