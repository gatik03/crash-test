import { describe, expect, it } from "vitest";
import { MockRail } from "./MockRail.js";
import { RailError } from "./Rail.js";
import { railContract } from "./railContract.js";

railContract(() => new MockRail());

describe("MockRail", () => {
  it("rejects a charge whose total differs from items plus fees", async () => {
    await expect(
      new MockRail().charge({
        scenarioRunId: "r",
        requestId: "q",
        items: [
          {
            name: "x",
            sku: "x",
            quantity: 2,
            unitAmount: { minor: 500, currency: "USD" },
          },
        ],
        fees: [],
        total: { minor: 999, currency: "USD" },
        description: "d",
      }),
    ).rejects.toBeInstanceOf(RailError);
  });

  it("rejects a malformed request as invalid_request", async () => {
    const bad = { requestId: "q" } as unknown as Parameters<
      MockRail["charge"]
    >[0];
    await expect(new MockRail().charge(bad)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("getOrder on an unknown id is not_found", async () => {
    await expect(new MockRail().getOrder("nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
