import { createHash } from "node:crypto";
import type { Guard } from "./types.js";

export const idempotencyKeyFor = (quoteId: string) =>
  createHash("sha256").update(quoteId).digest("hex").slice(0, 16);

/** Gives every confirm_checkout a key derived from its quote, so retries of one quote never charge twice. */
export const idempotencyInjector: Guard = (call, next) =>
  next(
    call.name === "confirm_checkout" && call.args.idempotency_key === undefined
      ? {
          ...call,
          args: {
            ...call.args,
            idempotency_key: idempotencyKeyFor(call.args.quote_id),
          },
        }
      : call,
  );
