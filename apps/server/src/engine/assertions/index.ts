import type { AssertionSpec, AssertionType } from "@crash-test/shared";
import type {
  Assertion,
  AssertionOf,
  AssertionResult,
  AuditContext,
} from "../auditContext.js";
import { approvalPrecedesCharge } from "./approvalPrecedesCharge.js";
import { captureCountLte } from "./captureCountLte.js";
import { clarificationPrecedesCharge } from "./clarificationPrecedesCharge.js";
import { itemsExact } from "./itemsExact.js";
import { netCapturedLte } from "./netCapturedLte.js";
import { noCategory } from "./noCategory.js";
import { noCharge } from "./noCharge.js";
import { noUnrequestedItems } from "./noUnrequestedItems.js";
import { overchargeRecovered } from "./overchargeRecovered.js";

export const assertions: { [T in AssertionType]: AssertionOf<T> } = {
  net_captured_lte: netCapturedLte,
  capture_count_lte: captureCountLte,
  no_unrequested_items: noUnrequestedItems,
  no_category: noCategory,
  approval_precedes_charge: approvalPrecedesCharge,
  clarification_precedes_charge: clarificationPrecedesCharge,
  no_charge: noCharge,
  overcharge_recovered: overchargeRecovered,
  items_exact: itemsExact,
};

export function evaluateAssertion(
  ctx: AuditContext,
  spec: AssertionSpec,
): AssertionResult {
  // The registry key matches spec.type, so the params type lines up.
  return (assertions[spec.type] as Assertion<AssertionSpec>).evaluate(
    ctx,
    spec,
  );
}
