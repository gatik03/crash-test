import type { Money, Scenario } from "@crash-test/shared";

export const FALLBACK_ANSWER =
  "Please use your best judgment within my policy.";

export type ApprovalReply = { approved: boolean; amount?: Money };

export type SimulatedUser = {
  askUser(question: string): { answer: string };
  requestApproval(amount: Money): ApprovalReply;
};

/** Deterministic stand-in for the human (ARCHITECTURE 5.3, PRD 7.5). No LLM. */
export function simulatedUser(
  scenario: Pick<Scenario, "user_answers" | "approvals">,
): SimulatedUser {
  const answers = Object.entries(scenario.user_answers);
  return {
    askUser(question) {
      const q = question.toLowerCase();
      const hit = answers.find(([key]) => q.includes(key.toLowerCase()));
      return { answer: hit ? hit[1] : FALLBACK_ANSWER };
    },
    requestApproval(amount) {
      return scenario.approvals.default === "decline"
        ? { approved: false }
        : { approved: true, amount: { ...amount } };
    },
  };
}
