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
        .array(z.enum(["Coffee", "Art", "Hiking"]))
        .min(1)
        .max(3),
      timeStart: z.iso.datetime(),
      timeEnd: z.iso.datetime(),
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
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "BaePal implemented core mutations",
    version: "0.1.0",
    description:
      "Generated request schemas from the Zod validators used by these routes. This document covers core mutations only; see docs/API.md for the complete implemented route inventory. No claim of complete response-schema coverage.",
  },
  servers: [{ url: "/api/v1" }],
  paths: Object.fromEntries(
    Object.entries(contractPaths).map(([path, [method, contract]]) => [
      path,
      {
        [method]: {
          summary: contract,
          security: path.startsWith("/auth/")
            ? []
            : [{ session: [], csrf: [] }],
          ...(path.includes("{id}")
            ? {
                parameters: [
                  {
                    in: "path",
                    name: "id",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ],
              }
            : {}),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${contract}` },
              },
            },
          },
          responses: {
            "200": {
              description:
                "JSON envelope {data: ...}; resource-specific ownership redaction applies.",
            },
            "400": { description: "Schema validation failed" },
            "401": { description: "Session missing or expired" },
            "403": { description: "Origin/CSRF/role denied" },
            "404": { description: "Unavailable resource" },
            "409": { description: "Version or consent conflict" },
            "422": { description: "Business constraint" },
            "429": { description: "Rate limited" },
            "503": {
              description: "Provider unavailable; retry the same operation",
            },
          },
        },
      },
    ]),
  ),
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "baepal" },
      csrf: { type: "apiKey", in: "header", name: "x-csrf-token" },
    },
    schemas: Object.fromEntries(
      Object.entries(Contracts).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { io: "input" }),
      ]),
    ),
  },
};
