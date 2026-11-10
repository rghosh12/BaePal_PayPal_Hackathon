import { z } from "zod";
import type { Row, State } from "./types";
export const CATEGORY_LABELS = {
  books: "Books",
  coffee: "Independent cafés",
  outdoors: "Outdoor activities",
  arts: "Art",
  music: "Music",
  games: "Board games",
} as const;
export type Category = keyof typeof CATEGORY_LABELS;
export const categorySchema = z.enum([
  "books",
  "coffee",
  "outdoors",
  "arts",
  "music",
  "games",
]);
export const TASTE_POLICY = {
  minimumPurchases: 20,
  minimumCoverageDays: 30,
  historyWindowDays: 180,
  featureExpiryDays: 30,
  perMerchantDayCap: 2,
  decayHalfLifeDays: 90,
} as const;
export const CONSENT_POLICY = "synthetic-taste-v1";
export const ALGORITHM_VERSION = "reviewed-counts-v1";
export const REAL_HISTORY_DISABLED =
  "Real purchase-history access and exports are unavailable pending verified account scope, permitted purpose and approval. PayPal login or payment does not grant history access.";
export type Family = "categories" | "brands" | "rhythms";
export type Purposes = {
  matching: boolean;
  publicTags: boolean;
  hostedAI: boolean;
  commercial: boolean;
};
export type Evidence = {
  id: string;
  ownerId: string;
  sourceType: "synthetic";
  sourceRecordKey: string;
  transactionKey: string;
  kind: "purchase" | "refund" | "transfer" | "fee";
  refundReference?: string;
  occurredAtUTC: string | null;
  sourceTimezone: string | null;
  timePrecision: "purchase_time" | "date_only" | "unknown";
  merchantRaw: string;
  merchantCanonical: string | null;
  category: Category | null;
  correctedCategory: Category | null;
  amountMinor: number;
  currency: string;
  status: "completed" | "refunded";
  sensitive: boolean;
  confidence: number;
  classification: "personal" | "gift" | "business" | "shared";
  excluded: boolean;
  version: number;
  importId: string;
  consentVersion: number;
};
export type Feature = {
  version: number;
  algorithmVersion: string;
  consentVersion: number;
  evidenceVersion: number;
  generatedAt: string;
  expiresAt: string;
  evidenceBased: boolean;
  usableCount: number;
  spanDays: number;
  availableFamilies: Family[];
  categories: Record<string, number>;
  brands: Record<string, number>;
  rhythms: Record<string, number>;
};
export type TasteState = {
  ownerId: string;
  source: "synthetic" | "declared";
  consent: {
    id: string;
    version: number;
    policyVersion: string;
    purposes: Purposes;
    families: Family[];
    changedAt: string | null;
    revokedAt: string | null;
    records: {
      purpose: keyof Purposes;
      active: boolean;
      version: number;
      changedAt: string;
    }[];
  };
  imports: Row[];
  evidence: Evidence[];
  evidenceVersion: number;
  featureSerial: number;
  feature: Feature | null;
  sharedTags: Category[];
  corrections: Row[];
};
const error = (status: number, code: string, message: string): never => {
  throw Object.assign(Error(message), { status, code });
};
export function emptyTaste(ownerId: string): TasteState {
  return {
    ownerId,
    source: "declared",
    consent: {
      id: ownerId,
      version: 0,
      policyVersion: CONSENT_POLICY,
      purposes: {
        matching: false,
        publicTags: false,
        hostedAI: false,
        commercial: false,
      },
      families: ["categories"],
      changedAt: null,
      revokedAt: null,
      records: [],
    },
    imports: [],
    evidence: [],
    evidenceVersion: 0,
    featureSerial: 0,
    feature: null,
    sharedTags: [],
    corrections: [],
  };
}
export function tasteFor(s: State, ownerId: string) {
  s.taste ||= {};
  return (s.taste[ownerId] ||= emptyTaste(ownerId));
}
const utcNow = () => new Date().toISOString();
function clearData(t: TasteState) {
  t.imports = [];
  t.evidence = [];
  t.feature = null;
  t.sharedTags = [];
  t.corrections = [];
  t.evidenceVersion++;
  t.source = "declared";
}
export const consentSchema = z.object({
  expectedVersion: z.number().int().min(0),
  purposes: z.object({
    matching: z.boolean(),
    publicTags: z.boolean(),
    hostedAI: z.boolean(),
    commercial: z.boolean(),
  }),
  families: z
    .array(z.enum(["categories", "brands", "rhythms"]))
    .min(1)
    .max(3),
});
export function saveConsent(t: TasteState, raw: unknown) {
  const b = consentSchema.parse(raw);
  if (b.expectedVersion !== t.consent.version)
    return error(
      409,
      "CONSENT_CONFLICT",
      "Your data permissions changed. Refresh first.",
    );
  const changedAt = utcNow(),
    version = t.consent.version + 1;
  for (const purpose of [
    "matching",
    "publicTags",
    "hostedAI",
    "commercial",
  ] as const) {
    if (t.consent.purposes[purpose] !== b.purposes[purpose])
      t.consent.records.push({
        purpose,
        active: b.purposes[purpose],
        version,
        changedAt,
      });
  }
  t.consent = {
    ...t.consent,
    version,
    changedAt,
    revokedAt: null,
    purposes: b.purposes,
    families: [...new Set(b.families)],
    records: t.consent.records.slice(-40),
  };
  t.feature = null;
  t.sharedTags = [];
  if (!b.purposes.matching) clearData(t);
  return t.consent;
}
export function revokeTaste(t: TasteState, consentId: string) {
  if (consentId !== t.consent.id)
    return error(404, "UNAVAILABLE", "Data consent unavailable.");
  const changedAt = utcNow();
  t.consent.version++;
  t.consent.purposes = {
    matching: false,
    publicTags: false,
    hostedAI: false,
    commercial: false,
  };
  t.consent.revokedAt = changedAt;
  t.consent.changedAt = changedAt;
  for (const purpose of [
    "matching",
    "publicTags",
    "hostedAI",
    "commercial",
  ] as const)
    t.consent.records.push({
      purpose,
      active: false,
      version: t.consent.version,
      changedAt,
    });
  t.consent.records = t.consent.records.slice(-40);
  clearData(t);
  return {
    revoked: true,
    consentVersion: t.consent.version,
    deleted: [
      "synthetic imports",
      "purchase evidence",
      "derived features",
      "shared tags",
      "review corrections",
    ],
    note: "Existing social matches and separately owned payment receipts are preserved.",
  };
}
function requireConsent(t: TasteState, version: number) {
  if (
    version !== t.consent.version ||
    !t.consent.purposes.matching ||
    t.consent.revokedAt
  )
    return error(
      409,
      "CONSENT_REQUIRED",
      "Enable purchase-interest matching and use the current consent version.",
    );
}
const aliases: Record<string, { canonical: string; category: Category }> = {
  "Demo Harbor Books": { canonical: "harbor-books", category: "books" },
  "Demo Cedar Coffee": { canonical: "cedar-coffee", category: "coffee" },
  "Demo Trail Outfitters": {
    canonical: "trail-outfitters",
    category: "outdoors",
  },
  "Demo Canvas Studio": { canonical: "canvas-studio", category: "arts" },
  "Demo Sound Shop": { canonical: "sound-shop", category: "music" },
  "Demo Board Game Café": { canonical: "board-game-cafe", category: "games" },
};
export interface PurchaseProvider {
  sourceType: string;
  load(
    dataset: string,
    ownerId: string,
    importId: string,
    consentVersion: number,
  ): Evidence[];
}
export class SyntheticPurchaseProvider implements PurchaseProvider {
  sourceType = "synthetic";
  load(
    dataset: string,
    ownerId: string,
    importId: string,
    consentVersion: number,
  ) {
    if (
      !["weekend-reader", "outdoor-explorer", "art-weekender"].includes(dataset)
    )
      return error(
        400,
        "INVALID_DATASET",
        "Choose a listed fictional dataset.",
      );
    const primary =
      dataset === "weekend-reader"
        ? "Demo Harbor Books"
        : dataset === "outdoor-explorer"
          ? "Demo Trail Outfitters"
          : "Demo Canvas Studio";
    const merchants = [
      ...Array(24).fill(primary),
      ...Array(12).fill("Demo Cedar Coffee"),
      ...Array(12).fill(
        dataset === "weekend-reader"
          ? "Demo Trail Outfitters"
          : "Demo Harbor Books",
      ),
    ];
    const day = new Date();
    day.setUTCHours(12, 0, 0, 0);
    const rows: Evidence[] = merchants.map((merchant, index) => ({
      id: crypto.randomUUID(),
      ownerId,
      sourceType: "synthetic",
      sourceRecordKey: `${dataset}:${index}:sale`,
      transactionKey: `${dataset}:${index}`,
      kind: "purchase",
      occurredAtUTC: new Date(
        day.getTime() - (index + 1) * 2 * 86400000,
      ).toISOString(),
      sourceTimezone: "America/Los_Angeles",
      timePrecision: "purchase_time",
      merchantRaw: merchant,
      merchantCanonical: aliases[merchant].canonical,
      category: aliases[merchant].category,
      correctedCategory: null,
      amountMinor: merchant === "Demo Cedar Coffee" ? 599 : 2500,
      currency: "USD",
      status: "completed",
      sensitive: false,
      confidence: 1,
      classification: "personal",
      excluded: false,
      version: 1,
      importId,
      consentVersion,
    }));
    const extra = (key: string, patch: Partial<Evidence>): Evidence => ({
      ...rows[1],
      id: crypto.randomUUID(),
      sourceRecordKey: `${dataset}:extra:${key}`,
      transactionKey: `${dataset}:extra:${key}`,
      ...patch,
    });
    rows.push({ ...rows[0], id: crypto.randomUUID() }); // Same source/event key: deduplicated on import.
    rows.push(
      extra("refund", {
        kind: "refund",
        refundReference: rows[0].sourceRecordKey,
      }),
      extra("gift", { classification: "gift" }),
      extra("business", { classification: "business" }),
      extra("shared", { classification: "shared" }),
      extra("transfer", { kind: "transfer", category: null }),
      extra("fee", { kind: "fee", category: null }),
      extra("sensitive", {
        merchantRaw: "Demo health service",
        merchantCanonical: null,
        category: null,
        sensitive: true,
        confidence: 1,
      }),
      extra("unknown", {
        merchantRaw: "Demo general marketplace",
        merchantCanonical: null,
        category: null,
        confidence: 0.2,
      }),
      extra("missing-timezone", {
        merchantRaw: "Demo Cedar Coffee",
        merchantCanonical: "cedar-coffee",
        category: "coffee",
        sourceTimezone: null,
        timePrecision: "unknown",
      }),
      extra("other-currency", { currency: "EUR" }),
    );
    return rows;
  }
}
export class AuthorizedPayPalHistoryProvider implements PurchaseProvider {
  sourceType = "paypal-history";
  load(
    _dataset: string,
    _ownerId: string,
    _importId: string,
    _consentVersion: number,
  ): Evidence[] {
    return error(403, "HISTORY_UNAVAILABLE", REAL_HISTORY_DISABLED);
  }
}
export class DeclaredPreferenceProvider {
  categories(interests: string[]) {
    const mapping: Record<string, Category> = {
      coffee: "coffee",
      books: "books",
      reading: "books",
      hiking: "outdoors",
      outdoors: "outdoors",
      art: "arts",
      arts: "arts",
      music: "music",
      games: "games",
      "board games": "games",
    };
    const counts: Record<string, number> = {};
    for (const i of interests) {
      const c = mapping[i.trim().toLowerCase()];
      if (c) counts[c] = 1;
    }
    return normalize(counts);
  }
}
function normalize(counts: Record<string, number>) {
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => [k, v / sum]),
  );
}
export function exclusionReasons(row: Evidence, all: Evidence[]) {
  const reasons: string[] = [];
  if (row.kind !== "purchase") reasons.push("non_purchase_event");
  if (
    row.status !== "completed" ||
    all.some(
      (r) => r.kind === "refund" && r.refundReference === row.sourceRecordKey,
    )
  )
    reasons.push("refunded_or_reversed");
  if (row.sensitive) reasons.push("sensitive_category");
  if (row.currency !== "USD") reasons.push("unsupported_currency");
  if (row.classification !== "personal")
    reasons.push(row.classification + "_purchase");
  if (row.excluded) reasons.push("member_excluded");
  if (!row.correctedCategory && !row.category)
    reasons.push("unknown_category_needs_review");
  const stamp = row.occurredAtUTC ? Date.parse(row.occurredAtUTC) : NaN;
  if (
    Number.isFinite(stamp) &&
    (Date.now() - stamp > TASTE_POLICY.historyWindowDays * 86400000 ||
      stamp > Date.now())
  )
    reasons.push("outside_synthetic_window");
  return reasons;
}
function rowsFor(t: TasteState) {
  const current = t.imports.find((x) => x.id === t.evidence[0]?.importId);
  if (current && Date.parse(current.expiresAt) < Date.now()) return [];
  return t.evidence.filter((r) => exclusionReasons(r, t.evidence).length === 0);
}
export function preview(t: TasteState) {
  const rows = rowsFor(t),
    counts: Record<string, number> = {},
    brands: Record<string, number> = {},
    rhythms: Record<string, number> = {},
    caps: Record<string, number> = {};
  for (const row of rows) {
    const category = row.correctedCategory || row.category!;
    const stamp = row.occurredAtUTC ? Date.parse(row.occurredAtUTC) : NaN;
    const day = Number.isFinite(stamp)
      ? new Date(stamp).toISOString().slice(0, 10)
      : "unknown";
    const capKey = (row.merchantCanonical || category) + ":" + day;
    if ((caps[capKey] || 0) >= TASTE_POLICY.perMerchantDayCap) continue;
    caps[capKey] = (caps[capKey] || 0) + 1;
    const decay = Number.isFinite(stamp)
      ? Math.pow(
          0.5,
          (Date.now() - stamp) / (TASTE_POLICY.decayHalfLifeDays * 86400000),
        )
      : 1;
    counts[category] = (counts[category] || 0) + decay;
    if (row.merchantCanonical)
      brands[row.merchantCanonical] =
        (brands[row.merchantCanonical] || 0) + decay;
    if (
      row.sourceTimezone &&
      row.timePrecision === "purchase_time" &&
      Number.isFinite(stamp)
    ) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: row.sourceTimezone,
          weekday: "short",
          hour: "numeric",
          hourCycle: "h23",
        }).formatToParts(new Date(stamp));
        const weekday = parts.find((p) => p.type === "weekday")?.value;
        const hour = Number(parts.find((p) => p.type === "hour")?.value);
        const bucket =
          (weekday === "Sat" || weekday === "Sun" ? "weekend" : "weekday") +
          ":" +
          (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");
        rhythms[bucket] = (rhythms[bucket] || 0) + decay;
      } catch {
        /* Unknown/invalid timezone contributes no rhythm. */
      }
    }
  }
  const times = rows
    .map((r) => (r.occurredAtUTC ? Date.parse(r.occurredAtUTC) : NaN))
    .filter(Number.isFinite);
  const spanDays = times.length
    ? Math.floor((Math.max(...times) - Math.min(...times)) / 86400000)
    : 0;
  const usableCount = rows.length;
  return {
    categories: normalize(counts),
    brands: normalize(brands),
    rhythms: normalize(rhythms),
    usableCount,
    spanDays,
    evidenceBased:
      usableCount >= TASTE_POLICY.minimumPurchases &&
      spanDays >= TASTE_POLICY.minimumCoverageDays,
    excludedCount: t.evidence.length - usableCount,
    threshold:
      "Prototype heuristic: at least 20 usable purchases across 30 days. Counts, not wealth, drive these features.",
  };
}
export function importDemo(t: TasteState, raw: unknown) {
  const b = z
    .object({
      datasetId: z.enum([
        "weekend-reader",
        "outdoor-explorer",
        "art-weekender",
      ]),
      idempotencyKey: z.string().uuid(),
      consentVersion: z.number().int(),
    })
    .parse(raw);
  requireConsent(t, b.consentVersion);
  const previous = t.imports.find((x) => x.idempotencyKey === b.idempotencyKey);
  if (previous) {
    if (
      previous.datasetId !== b.datasetId ||
      previous.consentVersion !== b.consentVersion
    )
      return error(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This import key was already used for another request.",
      );
    return previous;
  }
  const importId = crypto.randomUUID();
  const sourceRows = new SyntheticPurchaseProvider().load(
    b.datasetId,
    t.ownerId,
    importId,
    t.consent.version,
  );
  const unique = new Map<string, Evidence>();
  for (const row of sourceRows)
    if (!unique.has(row.sourceRecordKey)) unique.set(row.sourceRecordKey, row);
  t.evidence = [...unique.values()];
  t.evidenceVersion++;
  t.source = "synthetic";
  t.feature = null;
  t.sharedTags = [];
  t.corrections = [];
  const summary = preview(t);
  const job = {
    id: importId,
    datasetId: b.datasetId,
    idempotencyKey: b.idempotencyKey,
    consentVersion: b.consentVersion,
    sourceType: "synthetic",
    status: summary.excludedCount ? "partial" : "ready",
    stage: "ready_for_private_review",
    received: sourceRows.length,
    deduplicated: sourceRows.length - unique.size,
    stored: t.evidence.length,
    usable: summary.usableCount,
    excluded: summary.excludedCount,
    createdAt: utcNow(),
    expiresAt: new Date(
      Date.now() + TASTE_POLICY.historyWindowDays * 86400000,
    ).toISOString(),
    label: "Fictional synthetic purchase history — not PayPal data.",
  };
  t.imports.push(job);
  t.imports = t.imports.slice(-5);
  return job;
}
export function evidenceDTO(t: TasteState, limit = 100, offset = 0) {
  return {
    records: t.evidence.slice(offset, offset + limit).map((r) => ({
      ...r,
      exclusionReasons: exclusionReasons(r, t.evidence),
      effectiveCategory: r.correctedCategory || r.category,
      provenance: r.correctedCategory
        ? "member-corrected synthetic"
        : "synthetic fixture",
    })),
    total: t.evidence.length,
    nextOffset: offset + limit < t.evidence.length ? offset + limit : null,
    evidenceVersion: t.evidenceVersion,
    preview: preview(t),
  };
}
export function correctEvidence(
  t: TasteState,
  evidenceId: string,
  raw: unknown,
) {
  const b = z
    .object({
      expectedVersion: z.number().int(),
      consentVersion: z.number().int(),
      excluded: z.boolean().optional(),
      category: categorySchema.optional(),
      classification: z
        .enum(["personal", "gift", "business", "shared"])
        .optional(),
      excludeMerchant: z.literal(true).optional(),
    })
    .refine(
      (b) =>
        b.excluded !== undefined ||
        b.category ||
        b.classification ||
        b.excludeMerchant,
      { message: "Choose a correction." },
    )
    .parse(raw);
  requireConsent(t, b.consentVersion);
  const row = t.evidence.find((r) => r.id === evidenceId);
  if (!row) return error(404, "UNAVAILABLE", "Purchase evidence unavailable.");
  if (row.version !== b.expectedVersion)
    return error(
      409,
      "VERSION_CONFLICT",
      "This record changed. Refresh before editing.",
    );
  if (row.sensitive && b.category)
    return error(
      422,
      "SENSITIVE_EXCLUDED",
      "Sensitive evidence cannot be reclassified into a matching signal.",
    );
  const changed = b.excludeMerchant
    ? t.evidence.filter(
        (r) =>
          (r.merchantCanonical || r.merchantRaw) ===
          (row.merchantCanonical || row.merchantRaw),
      )
    : [row];
  for (const item of changed) {
    const old = {
      category: item.correctedCategory || item.category,
      classification: item.classification,
      excluded: item.excluded,
    };
    if (b.excludeMerchant || b.excluded !== undefined)
      item.excluded = b.excludeMerchant || !!b.excluded;
    if (b.category) item.correctedCategory = b.category;
    if (b.classification) item.classification = b.classification;
    item.version++;
    t.corrections.push({
      evidenceId: item.id,
      at: utcNow(),
      old,
      new: {
        category: item.correctedCategory || item.category,
        classification: item.classification,
        excluded: item.excluded,
      },
    });
  }
  t.corrections = t.corrections.slice(-150);
  t.evidenceVersion++;
  t.feature = null;
  t.sharedTags = [];
  return {
    updated: changed.length,
    evidenceVersion: t.evidenceVersion,
    preview: preview(t),
  };
}
export function rebuildTaste(t: TasteState, raw: unknown) {
  const b = z
    .object({
      consentVersion: z.number().int(),
      expectedEvidenceVersion: z.number().int(),
    })
    .parse(raw);
  requireConsent(t, b.consentVersion);
  if (b.expectedEvidenceVersion !== t.evidenceVersion)
    return error(
      409,
      "VERSION_CONFLICT",
      "Review data changed. Refresh before publishing.",
    );
  const p = preview(t);
  t.featureSerial++;
  const currentImport = t.imports.find((x) => x.id === t.evidence[0]?.importId);
  const expiresAt = new Date(
    Math.min(
      Date.now() + TASTE_POLICY.featureExpiryDays * 86400000,
      currentImport
        ? Date.parse(currentImport.expiresAt)
        : Date.now() + TASTE_POLICY.featureExpiryDays * 86400000,
    ),
  ).toISOString();
  const availableFamilies = t.consent.families.filter(
    (f) => Object.keys(p[f]).length > 0,
  );
  t.feature = {
    version: t.featureSerial,
    algorithmVersion: ALGORITHM_VERSION,
    consentVersion: t.consent.version,
    evidenceVersion: t.evidenceVersion,
    generatedAt: utcNow(),
    expiresAt,
    evidenceBased: p.evidenceBased,
    usableCount: p.usableCount,
    spanDays: p.spanDays,
    availableFamilies,
    categories: p.categories,
    brands: p.brands,
    rhythms: p.rhythms,
  };
  t.sharedTags = [];
  return ownTasteProfile(t);
}
function currentFeature(t: TasteState | undefined) {
  const f = t?.feature;
  if (
    !t ||
    !f ||
    !t.consent.purposes.matching ||
    t.consent.revokedAt ||
    f.consentVersion !== t.consent.version ||
    f.evidenceVersion !== t.evidenceVersion ||
    Date.parse(f.expiresAt) <= Date.now() ||
    !f.evidenceBased ||
    f.availableFamilies.length === 0
  )
    return null;
  return f;
}
export function ownTasteProfile(t: TasteState) {
  const f = currentFeature(t);
  return {
    source: t.source,
    label:
      t.source === "synthetic"
        ? "Demo purchase history"
        : "Self-declared interests",
    consent: t.consent,
    feature: t.feature,
    featureActive: !!f,
    evidenceGrade: f
      ? f.availableFamilies.length >= 3
        ? "strong"
        : f.availableFamilies.length >= 2
          ? "moderate"
          : "insufficient"
      : "insufficient",
    sharedTags: t.sharedTags,
    preview: preview(t),
    requiresRebuild: t.evidence.length > 0 && !t.feature,
    modelStatus: "not_configured",
    searchStatus: "deterministic_baseline",
    disclaimer:
      "This is lifestyle-pattern common ground, not romantic compatibility, wealth or financial-health assessment.",
  };
}
export function setSharing(t: TasteState, raw: unknown) {
  const b = z
    .object({
      consentVersion: z.number().int(),
      featureVersion: z.number().int(),
      tags: z.array(categorySchema).max(6),
    })
    .parse(raw);
  requireConsent(t, b.consentVersion);
  const f = currentFeature(t);
  if (!t.consent.purposes.publicTags)
    return error(
      403,
      "SHARING_CONSENT_REQUIRED",
      "Enable public explanation-tag sharing separately.",
    );
  if (!f || f.version !== b.featureVersion)
    return error(
      409,
      "VERSION_CONFLICT",
      "Publish a current sufficient-evidence feature version first.",
    );
  if (b.tags.some((tag) => !f.categories[tag]))
    return error(
      422,
      "UNSUPPORTED_TAG",
      "Only evidence-backed categories may be shared.",
    );
  t.sharedTags = [...new Set(b.tags)];
  return { sharedTags: t.sharedTags };
}
function cosine(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0,
    x = 0,
    y = 0;
  for (const k of keys) {
    dot += (a[k] || 0) * (b[k] || 0);
    x += (a[k] || 0) ** 2;
    y += (b[k] || 0) ** 2;
  }
  return x && y ? Math.max(0, Math.min(1, dot / Math.sqrt(x * y))) : 0;
}
function rhythmSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
) {
  let js = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0,
      y = b[k] || 0,
      m = (x + y) / 2;
    if (x) js += 0.5 * x * Math.log(x / m);
    if (y) js += 0.5 * y * Math.log(y / m);
  }
  return Math.max(0, Math.min(1, 1 - js / Math.log(2)));
}
export function compareTaste(
  a: Row,
  b: Row,
  aTaste?: TasteState,
  bTaste?: TasteState,
) {
  const af = currentFeature(aTaste),
    bf = currentFeature(bTaste),
    declared = new DeclaredPreferenceProvider();
  const av = {
      categories: af?.categories || declared.categories(a.interests),
      brands: af?.brands || {},
      rhythms: af?.rhythms || {},
    },
    bv = {
      categories: bf?.categories || declared.categories(b.interests),
      brands: bf?.brands || {},
      rhythms: bf?.rhythms || {},
    };
  const families: Family[] = ["categories", "brands", "rhythms"];
  const weights = { categories: 0.4, brands: 0.15, rhythms: 0.15 };
  let total = 0,
    score = 0,
    support = 0;
  for (const family of families) {
    if (
      (af && !af.availableFamilies.includes(family)) ||
      (bf && !bf.availableFamilies.includes(family)) ||
      !Object.keys(av[family]).length ||
      !Object.keys(bv[family]).length
    )
      continue;
    const value =
      family === "rhythms"
        ? rhythmSimilarity(av[family], bv[family])
        : cosine(av[family], bv[family]);
    score += weights[family] * value;
    total += weights[family];
    support++;
  }
  const shared =
    af &&
    bf &&
    aTaste?.consent.purposes.publicTags &&
    bTaste?.consent.purposes.publicTags
      ? aTaste.sharedTags
          .filter((t) => bTaste.sharedTags.includes(t))
          .slice(0, 3)
      : [];
  return {
    score: total ? score / total : 0,
    public: {
      basis:
        af || bf
          ? "Reviewed synthetic purchase interests"
          : "Self-declared interests",
      evidenceGrade:
        af && bf && support >= 3
          ? "strong"
          : af && bf && support >= 2
            ? "moderate"
            : "insufficient",
      commonGround: shared.map((t) => CATEGORY_LABELS[t]),
      reason: shared.length
        ? "You both opted to share these broad interests."
        : "No mutually approved purchase-derived tags are shared. You can still connect through public profile interests.",
      algorithmVersion: ALGORITHM_VERSION,
    },
    featureVersions: [af?.version || null, bf?.version || null],
  };
}
export function tasteCapabilities() {
  return {
    sources: [
      {
        type: "synthetic",
        status: "available",
        label: "Demo purchase history",
      },
      {
        type: "declared",
        status: "available",
        label: "Self-declared interests",
      },
      {
        type: "paypal-history",
        status: "blocked",
        label: "History integration unavailable",
        reason: REAL_HISTORY_DISABLED,
      },
      {
        type: "paypal-export",
        status: "blocked",
        label: "Export import unavailable",
        reason: REAL_HISTORY_DISABLED,
      },
    ],
    datasets: [
      { id: "weekend-reader", label: "Weekend reader · fictional" },
      { id: "outdoor-explorer", label: "Outdoor explorer · fictional" },
      { id: "art-weekender", label: "Art weekender · fictional" },
    ],
    paypalAccountConnection: "unavailable",
    paypalPayments: "mock_only",
    ai: "not_configured",
    elastic: "not_configured",
    realHistoryEnabled: false,
    liveDatingPaymentsApproved: false,
  };
}
