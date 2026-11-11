import { describe, expect, it } from "vitest";
import { dispatch, parseCall, TOOL_DEFS, TOOL_SCHEMAS } from "./tools.js";

describe("tools", () => {
  it("defines every tool once, plus finish", () => {
    expect(TOOL_DEFS.map((d) => d.function.name).sort()).toEqual(
      Object.keys(TOOL_SCHEMAS).sort(),
    );
    expect(TOOL_DEFS).toHaveLength(12);
  });

  it("rejects string, malformed and unknown calls without throwing", () => {
    expect(parseCall({ name: "get_order", args: "{bad" })).toMatchObject({
      ok: false,
      error: { error: { code: "invalid_arguments" } },
    });
    expect(
      parseCall({
        name: "add_to_cart",
        args: { product_id: "p", quantity: 0 },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        error: {
          code: "invalid_arguments",
          message: expect.stringContaining("quantity"),
        },
      },
    });
    expect(parseCall({ name: "rm_rf", args: {} })).toMatchObject({
      ok: false,
      error: { error: { code: "unknown_tool" } },
    });
    expect(parseCall({ name: "toString", args: {} })).toMatchObject({
      ok: false,
    });
    expect(
      parseCall({ name: "request_approval", args: { amount: "1e3" } }),
    ).toMatchObject({ ok: false });
  });

  it("normalizes amounts and dispatches to the executor", async () => {
    expect(
      parseCall({ name: "request_approval", args: { amount: 79 } }),
    ).toEqual({
      ok: true,
      call: { name: "request_approval", args: { amount: "79.00" } },
    });
    const out = await dispatch(
      { name: "get_order", args: { order_id: "o1" } },
      async (c) => ({ got: c }),
    );
    expect(out).toEqual({
      got: { name: "get_order", args: { order_id: "o1" } },
    });
  });
});
