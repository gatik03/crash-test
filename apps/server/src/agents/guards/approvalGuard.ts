import { cents, seenQuote, blocked, usd, type Guard } from "./types.js";

/** Blocks confirm_checkout above `approval_required_over` unless an approved request covers the quote total. */
export const approvalGuard: Guard = async (call, next, { policy, history }) => {
  const threshold = policy.approval_required_over?.minor;
  if (call.name !== "confirm_checkout" || threshold === undefined)
    return next(call);
  const total = seenQuote(history, call.args.quote_id)?.total;
  if (total === undefined || total <= threshold) return next(call);
  const covered = history.some(
    (s) =>
      s.call.name === "request_approval" &&
      s.result["approved"] === true &&
      (cents(s.call.args.amount) ?? 0) >= total,
  );
  if (covered) return next(call);
  return blocked(
    "approval",
    `The total ${usd(total)} is over the approval threshold of ${usd(threshold)} and no approval covers it. ` +
      `Call request_approval for ${usd(total)} first; if the user declines, do not pay.`,
  );
};
