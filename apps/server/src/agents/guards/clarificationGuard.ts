import { blocked, seenProducts, type Guard } from "./types.js";

/** Heuristic: with `clarify_when_ambiguous`, two or more seen products in one category require an ask_user before paying. */
export const clarificationGuard: Guard = async (
  call,
  next,
  { policy, history },
) => {
  if (call.name !== "confirm_checkout" || !policy.clarify_when_ambiguous)
    return next(call);
  if (history.some((s) => s.call.name === "ask_user")) return next(call);
  const perCategory = new Map<string, number>();
  for (const p of seenProducts(history).values()) {
    if (p.category === undefined) continue;
    const n = (perCategory.get(p.category) ?? 0) + 1;
    perCategory.set(p.category, n);
    if (n >= 2)
      return blocked(
        "clarification",
        `Several ${p.category} products match the request. Ask the user which one they want (ask_user) before paying.`,
      );
  }
  return next(call);
};
