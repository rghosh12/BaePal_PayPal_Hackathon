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
  createHoldOrder(amount: number, depositId: string, planId: string, key: string): Promise<Order>;
  authorizeOrder(id: string, key: string): Promise<Order>;
  voidAuthorization(id: string, key: string): Promise<void>;
  captureAuthorization(id: string, amount: number, key: string): Promise<any>;
  createPayout(email: string, amount: number, note: string, key: string): Promise<any>;
}
const money = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw Error("Invalid USD cent amount");
  const digits = String(amount).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
export class SandboxPayPal implements PaymentProvider {
  private base = "https://api-m.sandbox.paypal.com";
  private token: { value: string; expiresAt: number } | null = null;
  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    const auth = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(12000),
    });
    if (!auth.ok) {
      console.error(
        JSON.stringify({ paypal: { op: "oauth", status: auth.status } }),
      );
      throw Error("PayPal authentication unavailable");
    }
    const { access_token, expires_in } = (await auth.json()) as any;
    this.token = {
      value: access_token,
      expiresAt: Date.now() + Number(expires_in || 300) * 1000,
    };
    return access_token as string;
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const access_token = await this.accessToken();
    const r = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        // Capture verification needs payee/custom_id, absent from minimal responses.
        Prefer: "return=representation",
        ...(key ? { "PayPal-Request-Id": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      if (r.status === 401) this.token = null;
      // Log only PayPal's error name/issue and debug_id, never payloads or secrets.
      const err = (await r.json().catch(() => ({}))) as any;
      console.error(
        JSON.stringify({
          paypal: {
            op: `${method} ${path.replace(/\/[A-Z0-9-]{10,}/g, "/:id")}`,
            status: r.status,
            name: err?.name,
            issue: err?.details?.[0]?.issue,
            debugId: err?.debug_id,
          },
        }),
      );
      throw Error("PayPal operation requires reconciliation");
    }
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
  createHoldOrder(amount: number, depositId: string, planId: string, key: string) {
    return this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: depositId,
            custom_id: depositId,
            description: "BaePal no-show protection hold (released if you show up)",
            payee: { merchant_id: config.PAYPAL_MERCHANT_ID },
            amount: { currency_code: "USD", value: money(amount) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "BaePal Date Protection",
              user_action: "CONTINUE",
              shipping_preference: "NO_SHIPPING",
              return_url: `${config.APP_ORIGIN}/dates/${planId}?hold=approved`,
              cancel_url: `${config.APP_ORIGIN}/dates/${planId}?hold=cancelled`,
            },
          },
        },
      },
      key,
    );
  }
  authorizeOrder(id: string, key: string) {
    return this.request(
      `/v2/checkout/orders/${encodeURIComponent(id)}/authorize`,
      "POST",
      {},
      key,
    );
  }
  async voidAuthorization(id: string, key: string) {
    const access_token = await this.accessToken();
    const r = await fetch(
      `${this.base}/v2/payments/authorizations/${encodeURIComponent(id)}/void`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "PayPal-Request-Id": key,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    // 204 on success; 422 AUTHORIZATION_ALREADY_VOIDED on replay is also final.
    if (!r.ok && r.status !== 422) {
      console.error(JSON.stringify({ paypal: { op: "void", status: r.status } }));
      throw Error("PayPal void requires reconciliation");
    }
  }
  captureAuthorization(id: string, amount: number, key: string) {
    return this.request(
      `/v2/payments/authorizations/${encodeURIComponent(id)}/capture`,
      "POST",
      {
        amount: { currency_code: "USD", value: money(amount) },
        final_capture: true,
      },
      key,
    );
  }
  createPayout(email: string, amount: number, note: string, key: string) {
    return this.request(
      "/v1/payments/payouts",
      "POST",
      {
        sender_batch_header: {
          sender_batch_id: key,
          email_subject: "You have a payout from BaePal",
          email_message: note,
        },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: email,
            amount: { currency: "USD", value: money(amount) },
            note,
            sender_item_id: key,
          },
        ],
      },
      key,
    );
  }
  async verifyWebhook(headers: Record<string, unknown>, event: unknown) {
    // Without a configured webhook ID nothing can be verified: fail closed.
    if (!config.PAYPAL_WEBHOOK_ID) return false;
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
  async createHoldOrder(amount: number, depositId: string, _planId: string, key: string) {
    return {
      id: `MOCK-HOLD-${key}`,
      status: "CREATED",
      purchase_units: [
        {
          reference_id: depositId,
          amount: { currency_code: "USD", value: money(amount) },
        },
      ],
    };
  }
  async authorizeOrder(id: string, _key: string) {
    return {
      id,
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            authorizations: [{ id: `AUTH-${id}`, status: "CREATED" }],
          },
        },
      ],
    };
  }
  async voidAuthorization() {}
  async captureAuthorization(id: string, amount: number) {
    return {
      id: `CAP-${id}`,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: money(amount) },
    };
  }
  async createPayout(_email: string, _amount: number, _note: string, key: string) {
    return { batch_header: { payout_batch_id: `PAYOUT-${key}`, batch_status: "SUCCESS" } };
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

// PayPal USD wire amounts are canonical decimal strings. Do not coerce them
// through Number or multiply floats: valid cent amounts can round incorrectly.
export function verifiedRefund(result: any, amountCents: number) {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.id !== "string" ||
    !result.id.trim()
  )
    throw Error("Refund evidence unavailable");
  if (result.status === "COMPLETED") {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
      throw Error("Refund amount mismatch");
    if (
      config.PAYPAL_MODE === "sandbox" &&
      (result.amount?.currency_code !== "USD" ||
        typeof result.amount?.value !== "string" ||
        result.amount.value !== money(amountCents))
    )
      throw Error("Refund amount mismatch");
  }
  return result;
}
