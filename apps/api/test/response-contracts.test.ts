import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  catalogueSnapshot,
  paymentResponse,
} from "../src/response-contracts.js";
const snapshot = {
  id: "art",
  title: "Fictional art",
  activity: "Art",
  description: "Fictional catalogue entry",
  address: "Demo venue",
  price_cents: 3000,
  duration_minutes: 60,
  accessibility: "Demo step-free",
  policy: "Demo refund policy",
};
const payment = () => ({
  id: randomUUID(),
  purchase_id: randomUUID(),
  plan_id: randomUUID(),
  version: 1,
  mode: "mock",
  state: "completed",
  amount_cents: 3000,
  currency: "USD",
  snapshot,
  order_id: "mock-order",
  capture_id: "mock-capture",
  created_at: new Date("2026-11-10T00:00:00.000Z"),
  updated_at: new Date("2026-11-10T00:00:00.000Z"),
  refunds: [
    { amount_cents: 3000, state: "pending", provider_id: "mock-refund" },
  ],
});
describe("financial response contracts", () => {
  it("allowlists nested snapshots, receipts and refund evidence", () => {
    const projected = paymentResponse({
      ...payment(),
      buyer_id: randomUUID(),
      internal_payload: { access_token: "private-fixture" },
      snapshot: {
        ...snapshot,
        earliestStart: "private-window",
        latestEnd: "private-window",
        raw_receipt: "private-fixture",
      },
      refunds: [
        {
          amount_cents: 3000,
          state: "pending",
          provider_id: "mock-refund",
          provider_payload: "private-fixture",
        },
      ],
    });
    const text = JSON.stringify(projected);
    for (const forbidden of [
      "buyer_id",
      "private-fixture",
      "private-window",
      "provider_payload",
    ])
      expect(text).not.toContain(forbidden);
    expect(projected.order_id).toBe("mock-order");
    expect(projected.refunds[0].provider_id).toBe("mock-refund");
    expect(projected.created_at).toBe("2026-11-10T00:00:00.000Z");
  });
  it("fails closed on invalid stored lifecycle or amount without exposing stored values", () => {
    for (const value of [
      { ...payment(), state: "private-invalid-fixture" },
      { ...payment(), amount_cents: -3000 },
      { ...payment(), currency: "EUR" },
    ]) {
      expect(() => paymentResponse(value)).toThrow(
        "Stored response does not match its contract.",
      );
    }
  });
  it("removes planning windows without dropping purchased catalogue details", () => {
    expect(
      catalogueSnapshot({
        ...snapshot,
        earliestStart: "private-window",
        latestEnd: "private-window",
      }),
    ).toEqual(snapshot);
  });
});
