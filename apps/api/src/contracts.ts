import { z } from "zod";
const uuid = z.string().uuid();
export const Contracts = {
  Signup: z.object({
    email: z.email().max(254),
    password: z.string().min(12).max(128),
    adult: z.literal(true),
    terms: z.literal(true),
  }),
  Login: z.object({ email: z.email(), password: z.string().max(128) }),
  Decision: z.object({
    targetId: uuid,
    action: z.enum(["like", "pass"]),
    clientMutationId: uuid,
  }),
  Message: z.object({
    text: z.string().trim().min(1).max(2000),
    clientMessageId: uuid,
  }),
  PrivatePreferences: z
    .object({
      budgetCents: z.number().int().min(0).max(100000),
      activities: z
        .array(z.enum(["Coffee", "Art", "Hiking", "Books", "Music", "Food"]))
        .min(1)
        .max(6),
      timeStart: z.iso.datetime(),
      timeEnd: z.iso.datetime(),
      stepFree: z.boolean().optional(),
      neighborhoods: z.array(z.string().max(40)).max(10).optional(),
      timezone: z
        .string()
        .max(64)
        .refine((tz) => {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, "Unknown time zone")
        .optional(),
    })
    .refine(
      (b) =>
        new Date(b.timeEnd) > new Date(b.timeStart) &&
        new Date(b.timeStart).getTime() > Date.now(),
      { message: "Choose a future start and a later end time." },
    ),
  Proposal: z.object({
    optionId: z.string().max(40),
    startsAt: z.iso.datetime(),
    expectedVersion: z.number().int(),
  }),
  Acceptance: z.object({ proposalVersion: z.number().int() }),
  Purchase: z.object({ planId: uuid, proposalVersion: z.number().int() }),
  Order: z.object({ paymentId: uuid }),
};
const contractPaths: Record<string, [string, keyof typeof Contracts]> = {
  "/auth/signup": ["post", "Signup"],
  "/auth/login": ["post", "Login"],
  "/decisions": ["post", "Decision"],
  "/conversations/{id}/messages": ["post", "Message"],
  "/date-plans/{id}/private-preferences": ["put", "PrivatePreferences"],
  "/date-plans/{id}/proposals": ["post", "Proposal"],
  "/date-plans/{id}/accept": ["post", "Acceptance"],
  "/purchases": ["post", "Purchase"],
  "/payments/orders": ["post", "Order"],
};
const errorRef = {
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
};
const PUBLIC = /^\/(health|ready|config|openapi\.json|time\/resolve|auth\/(signup|login|password\/request|password\/reset)|webhooks\/paypal)$/;
// Built from the routes Fastify actually registered, so the inventory cannot
// drift from the implementation. Request schemas come from the same Zod
// validators the handlers use.
export function buildOpenApi(routes: { method: string; url: string }[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, url } of routes) {
    if (!url.startsWith("/api/v1/") || method === "HEAD") continue;
    const path = url.slice(7).replace(/:(\w+)/g, "{$1}");
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      in: "path",
      name: m[1],
      required: true,
      schema:
        m[1] === "provider"
          ? { type: "string", enum: ["github", "linkedin"] }
          : { type: "string", format: "uuid" },
    }));
    const lower = method.toLowerCase();
    const known = contractPaths[path];
    const contract = known && known[0] === lower ? known[1] : null;
    const isPublic = PUBLIC.test(path);
    paths[path] = {
      ...paths[path],
      [lower]: {
        operationId: `${lower}_${path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        security: isPublic
          ? []
          : lower === "get"
            ? [{ session: [] }]
            : [{ session: [], csrf: [] }],
        ...(params.length ? { parameters: params } : {}),
        ...(contract
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${contract}` },
                  },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description:
              "Envelope {data}. Ownership redaction applies; see docs/RESPONSE_PRIVACY.md.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Envelope" },
              },
            },
          },
          "400": { description: "Validation failed", ...errorRef },
          ...(isPublic
            ? {}
            : {
                "401": { description: "Session missing or expired", ...errorRef },
                "403": { description: "Origin, CSRF, role or step-up denied", ...errorRef },
              }),
          "404": { description: "Unavailable (also used to avoid revealing existence)", ...errorRef },
          "409": { description: "Version, state or consent conflict", ...errorRef },
          "422": { description: "Business constraint", ...errorRef },
          "429": { description: "Rate limited", ...errorRef },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "BaePal API",
      version: "0.2.0",
      description:
        "Every registered /api/v1 route. Request bodies for core mutations come from the handlers' Zod validators; other routes validate inline with Zod and return 400 VALIDATION on mismatch. Responses use the {data} envelope or the Error schema.",
    },
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "baepal" },
        csrf: { type: "apiKey", in: "header", name: "x-csrf-token" },
      },
      schemas: {
        Envelope: {
          type: "object",
          required: ["data"],
          properties: { data: {}, nextCursor: { type: ["string", "null"] } },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
        ...Object.fromEntries(
          Object.entries(Contracts).map(([name, schema]) => [
            name,
            z.toJSONSchema(schema, { io: "input" }),
          ]),
        ),
      },
    },
  };
}
