import { describe, it, expect } from "vitest";
import { verifiedCapture } from "../src/providers/paypal.js";
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
    } finally {
      config.PAYPAL_MODE = oldMode;
      config.PAYPAL_MERCHANT_ID = oldMerchant;
    }
  });
});
