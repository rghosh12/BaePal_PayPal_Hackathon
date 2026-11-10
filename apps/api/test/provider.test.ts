import { describe, it, expect } from "vitest";
import { verifiedCapture, verifiedRefund } from "../src/providers/paypal.js";
import { config } from "../src/config.js";
describe("Sandbox capture binding", () => {
  const purchase = {
    id: "purchase-1",
    order_id: "order-1",
    amount_cents: 3000,
  };
  const valid = () => ({
    id: "order-1",
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: "purchase-1",
        custom_id: "purchase-1",
        payee: { merchant_id: "merchant-1" },
        payments: {
          captures: [
            {
              id: "capture-1",
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "30.00" },
            },
          ],
        },
      },
    ],
  });
  it("checks order, buyer-bound purchase, merchant, exact amount and currency", () => {
    const oldMode = config.PAYPAL_MODE,
      oldMerchant = config.PAYPAL_MERCHANT_ID;
    try {
      config.PAYPAL_MODE = "sandbox";
      config.PAYPAL_MERCHANT_ID = "merchant-1";
      expect(verifiedCapture(valid(), purchase)?.id).toBe("capture-1");
      for (const corrupt of [
        (o: any) => (o.id = "foreign-order"),
        (o: any) => (o.purchase_units[0].reference_id = "other-purchase"),
        (o: any) => (o.purchase_units[0].custom_id = "other-purchase"),
        (o: any) => (o.purchase_units[0].payee.merchant_id = "wrong-merchant"),
        (o: any) =>
          (o.purchase_units[0].payments.captures[0].amount.value = "0.01"),
        (o: any) =>
          (o.purchase_units[0].payments.captures[0].amount.currency_code =
            "EUR"),
      ]) {
        const o = valid();
        corrupt(o);
        expect(() => verifiedCapture(o, purchase)).toThrow(
          "Capture verification mismatch",
        );
      }
      expect(
        verifiedCapture({ id: "order-1", status: "APPROVED" }, purchase),
      ).toBeNull();
      for (const amount_cents of [
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ])
        expect(() =>
          verifiedCapture(valid(), { ...purchase, amount_cents }),
        ).toThrow("Invalid USD cent amount");
    } finally {
      config.PAYPAL_MODE = oldMode;
      config.PAYPAL_MERCHANT_ID = oldMerchant;
    }
  });
});

describe("Sandbox refund evidence", () => {
  const completed = (value: unknown, currency = "USD") => ({
    id: "synthetic-refund",
    status: "COMPLETED",
    amount: { currency_code: currency, value },
  });
  it("requires exact canonical USD strings instead of numeric coercion", () => {
    const original = config.PAYPAL_MODE;
    try {
      config.PAYPAL_MODE = "sandbox";
      for (const [cents, value] of [
        [29, "0.29"],
        [251, "2.51"],
        [3000, "30.00"],
      ] as const)
        expect(verifiedRefund(completed(value), cents).id).toBe(
          "synthetic-refund",
        );
      for (const value of [
        30,
        "3e1",
        "30",
        "30.000",
        " 30.00 ",
        "+30.00",
        "0x1e",
        "030.00",
        "29.99",
        null,
        undefined,
      ])
        expect(() => verifiedRefund(completed(value), 3000)).toThrow(
          "Refund amount mismatch",
        );
      expect(() => verifiedRefund(completed("30.00", "EUR"), 3000)).toThrow(
        "Refund amount mismatch",
      );
      for (const cents of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ])
        expect(() => verifiedRefund(completed("30.00"), cents)).toThrow(
          "Refund amount mismatch",
        );
    } finally {
      config.PAYPAL_MODE = original;
    }
  });
  it("preserves each cent across the full safe-integer formatting range", () => {
    const original = config.PAYPAL_MODE;
    try {
      config.PAYPAL_MODE = "sandbox";
      const cents = 7036874417766401;
      expect(verifiedRefund(completed("70368744177664.01"), cents).id).toBe(
        "synthetic-refund",
      );
      expect(() =>
        verifiedRefund(completed("70368744177664.02"), cents),
      ).toThrow("Refund amount mismatch");
      expect(
        verifiedRefund(completed("90071992547409.91"), Number.MAX_SAFE_INTEGER)
          .id,
      ).toBe("synthetic-refund");
    } finally {
      config.PAYPAL_MODE = original;
    }
  });
  it("requires provider reference evidence but leaves pending refunds pending", () => {
    const original = config.PAYPAL_MODE;
    try {
      config.PAYPAL_MODE = "sandbox";
      expect(
        verifiedRefund(
          { id: "synthetic-pending-refund", status: "PENDING" },
          29,
        ).status,
      ).toBe("PENDING");
      for (const result of [
        null,
        {},
        { id: 123, status: "COMPLETED" },
        { id: " ", status: "COMPLETED" },
      ])
        expect(() => verifiedRefund(result, 29)).toThrow(
          "Refund evidence unavailable",
        );
    } finally {
      config.PAYPAL_MODE = original;
    }
  });
});
