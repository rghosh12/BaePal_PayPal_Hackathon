import { config } from "../config.js";
export type Order = {
  id: string;
  status: string;
  purchase_units?: any[];
  links?: { rel: string; href: string }[];
};
export interface PaymentProvider {
  createOrder(amount: number, purchaseId: string, key: string): Promise<Order>;
  getOrder(id: string): Promise<Order>;
  captureOrder(id: string, key: string): Promise<Order>;
  refundCapture(id: string, amount: number, key: string): Promise<any>;
  getRefund(id: string): Promise<any>;
  verifyWebhook(
    headers: Record<string, unknown>,
    event: unknown,
  ): Promise<boolean>;
}
const money = (amount: number) => (amount / 100).toFixed(2);
export class SandboxPayPal implements PaymentProvider {
  private base = "https://api-m.sandbox.paypal.com";
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const auth = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(12000),
    });
    if (!auth.ok) throw Error("PayPal authentication unavailable");
    const { access_token } = (await auth.json()) as any;
    const r = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        ...(key ? { "PayPal-Request-Id": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("PayPal operation requires reconciliation");
    return r.json() as Promise<any>;
  }
  createOrder(amount: number, purchaseId: string, key: string) {
    return this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: purchaseId,
            custom_id: purchaseId,
            payee: { merchant_id: config.PAYPAL_MERCHANT_ID },
            amount: { currency_code: "USD", value: money(amount) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "BaePal Demo Merchant",
              user_action: "PAY_NOW",
              return_url: `${config.APP_ORIGIN}/checkout/${purchaseId}?approved=1`,
              cancel_url: `${config.APP_ORIGIN}/checkout/${purchaseId}?cancelled=1`,
            },
          },
        },
      },
      key,
    );
  }
  getOrder(id: string) {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`);
  }
  captureOrder(id: string, key: string) {
    return this.request(
      `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
      "POST",
      {},
      key,
    );
  }
  refundCapture(id: string, amount: number, key: string) {
    return this.request(
      `/v2/payments/captures/${encodeURIComponent(id)}/refund`,
      "POST",
      { amount: { currency_code: "USD", value: money(amount) } },
      key,
    );
  }
  getRefund(id: string) {
    return this.request(`/v2/payments/refunds/${encodeURIComponent(id)}`);
  }
  async verifyWebhook(headers: Record<string, unknown>, event: unknown) {
    const result = await this.request(
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: config.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      },
    );
    return result.verification_status === "SUCCESS";
  }
}
// Stateless deterministic fixture provider. Never claims to contact PayPal.
export class MockPayPal implements PaymentProvider {
  async createOrder(amount: number, purchaseId: string, key: string) {
    return {
      id: `MOCK-${key}`,
      status: "CREATED",
      purchase_units: [
        {
          reference_id: purchaseId,
          amount: { currency_code: "USD", value: money(amount) },
        },
      ],
    };
  }
  async getOrder(id: string) {
    return { id, status: "APPROVED" };
  }
  async captureOrder(id: string, _key: string) {
    return {
      id,
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ id: `CAP-${id}`, status: "COMPLETED" }] } },
      ],
    };
  }
  async refundCapture(_id: string, amount: number, key: string) {
    return {
      id: `REF-${key}`,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: money(amount) },
    };
  }
  async getRefund(id: string) {
    return { id, status: "COMPLETED" };
  }
  async verifyWebhook() {
    return false;
  }
}
export const provider: PaymentProvider =
  config.PAYPAL_MODE === "sandbox" ? new SandboxPayPal() : new MockPayPal();
export function verifiedCapture(order: Order, purchase: any) {
  const unit = order.purchase_units?.[0];
  const captures = unit?.payments?.captures;
  const capture = captures?.[0];
  if (!capture) return null;
  if (config.PAYPAL_MODE === "sandbox") {
    if (
      order.id !== purchase.order_id ||
      order.purchase_units?.length !== 1 ||
      unit.reference_id !== purchase.id ||
      unit.custom_id !== purchase.id ||
      unit.payee?.merchant_id !== config.PAYPAL_MERCHANT_ID ||
      captures.length !== 1 ||
      capture.amount?.currency_code !== "USD" ||
      capture.amount?.value !== money(purchase.amount_cents)
    )
      throw Error("Capture verification mismatch");
  }
  return capture;
}
