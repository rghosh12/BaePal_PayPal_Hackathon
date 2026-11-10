import { z } from "zod";

// Zod objects strip unknown keys at every nested boundary. Catalogue responses
// describe the purchased experience, never private preference-window metadata.
export const CatalogueSnapshot = z.object({
  id: z.string(),
  title: z.string(),
  activity: z.string(),
  description: z.string(),
  address: z.string(),
  price_cents: z.number().int().nonnegative(),
  duration_minutes: z.number().int().positive(),
  accessibility: z.string(),
  policy: z.string(),
});
const timestamp = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.iso.datetime(),
);
const reference = z.string().nullable();
const paymentState = z.enum([
  "created",
  "approval_pending",
  "capture_pending",
  "pending",
  "unknown",
  "completed",
  "refunded",
]);
export const RefundResponse = z.object({
  amount_cents: z.number().int().positive(),
  state: z.enum(["requested", "pending", "completed", "failed"]),
  provider_id: reference,
});
export const PaymentSummaryResponse = z.object({
  id: z.uuid(),
  state: paymentState,
  mode: z.enum(["mock", "sandbox"]),
  amount_cents: z.number().int().positive(),
  currency: z.literal("USD"),
  snapshot: CatalogueSnapshot,
});
export const PaymentResponse = PaymentSummaryResponse.extend({
  purchase_id: z.uuid(),
  plan_id: z.uuid(),
  version: z.number().int().nonnegative(),
  order_id: reference,
  capture_id: reference,
  created_at: timestamp,
  updated_at: timestamp,
  refunds: z.array(RefundResponse),
});
export const PurchaseResponse = z.object({
  id: z.uuid(),
  plan_id: z.uuid(),
  version: z.number().int().nonnegative(),
  amount_cents: z.number().int().positive(),
  currency: z.literal("USD"),
  snapshot: CatalogueSnapshot,
  state: z.enum(["created", "paid", "refunded"]),
  payment_id: z.uuid(),
  payment: PaymentResponse,
});
function project<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  // Invalid stored output is a server error. Never expose stored values or Zod
  // diagnostics through the request-validation error handler.
  if (!parsed.success)
    throw Error("Stored response does not match its contract.");
  return parsed.data;
}
export const catalogueSnapshot = (value: unknown) =>
  project(CatalogueSnapshot, value);
export const paymentResponse = (value: unknown) =>
  project(PaymentResponse, value);
export const paymentSummariesResponse = (value: unknown) =>
  project(z.array(PaymentSummaryResponse), value);
export const purchaseResponse = (value: unknown) =>
  project(PurchaseResponse, value);
