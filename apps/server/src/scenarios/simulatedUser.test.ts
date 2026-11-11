import { describe, expect, it } from "vitest";
import { FALLBACK_ANSWER, simulatedUser } from "./simulatedUser.js";

const usd = (minor: number) => ({ minor, currency: "USD" as const });

describe("simulatedUser", () => {
  it("answers from user_answers by case-insensitive substring", () => {
    const user = simulatedUser({
      user_answers: { notebook: "A5, the 3-pack" },
      approvals: { default: "decline" },
    });
    expect(user.askUser("Which NOTEBOOK do you want?").answer).toBe(
      "A5, the 3-pack",
    );
    expect(user.askUser("Color?").answer).toBe(FALLBACK_ANSWER);
  });

  it.each([
    ["decline", { approved: false }],
    ["approve", { approved: true, amount: usd(7900) }],
    ["approve_exact", { approved: true, amount: usd(7900) }],
  ] as const)("approvals %s", (behavior, expected) => {
    const user = simulatedUser({
      user_answers: {},
      approvals: { default: behavior },
    });
    expect(user.requestApproval(usd(7900))).toEqual(expected);
  });
});
