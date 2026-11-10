"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Check,
  Trash2,
} from "lucide-react";
type Row = Record<string, any>;
type Props = {
  path: string;
  api: (url: string, method?: string, body?: unknown) => Promise<any>;
};
const labels: Record<string, string> = {
  books: "Books",
  coffee: "Independent cafés",
  outdoors: "Outdoor activities",
  arts: "Art",
  music: "Music",
  games: "Board games",
};
export default function TasteWorkspace({ path, api }: Props) {
  const router = useRouter();
  const [profile, setProfile] = useState<Row | null>(null),
    [evidence, setEvidence] = useState<Row | null>(null),
    [capabilities, setCapabilities] = useState<Row | null>(null),
    [purposes, setPurposes] = useState({
      matching: false,
      publicTags: false,
      hostedAI: false,
      commercial: false,
    }),
    [families, setFamilies] = useState<string[]>(["categories"]),
    [selectedTags, setSelectedTags] = useState<string[]>([]),
    [dataset, setDataset] = useState("weekend-reader"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [importStatus, setImportStatus] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const [p, e, c] = await Promise.all([
      api("/taste/profile"),
      api("/taste/evidence?limit=100"),
      api("/taste/capabilities"),
    ]);
    setProfile(p);
    setEvidence(e);
    setCapabilities(c);
    setPurposes(p.consent.purposes);
    setFamilies(p.consent.families);
    setSelectedTags(p.sharedTags);
    if (path.startsWith("/taste/imports/")) setImportStatus(await api(path));
  }, [api, path]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    load()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function correction(record: Row, patch: Row) {
    await api(`/taste/evidence/${record.id}`, "PATCH", {
      expectedVersion: record.version,
      consentVersion: profile!.consent.version,
      ...patch,
    });
    setNotice(
      "Correction saved. The old derived version is no longer used. Review the preview, then publish a new summary.",
    );
  }
  const submit = (fn: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    void act(fn);
  };
  const tabs = [
    ["/taste/connect", "Sources"],
    ["/taste/consent", "Permissions"],
    ["/taste/review", "Private review"],
    ["/taste/profile", "Your summary"],
    ["/settings/data", "Stop & delete"],
  ];
  return (
    <div className="taste-workspace">
      <header className="page-heading">
        <span className="eyebrow">YOU CHOOSE WHAT COUNTS</span>
        <h1>Your purchase interests.</h1>
        <p>
          Meet someone who spends their weekends like you. This prototype uses
          fictional purchase evidence, never real PayPal history.
        </p>
      </header>
      <nav className="taste-tabs" aria-label="Purchase interest workspace">
        {tabs.map(([href, label]) => (
          <Link
            href={href}
            key={href}
            className={path === href ? "selected" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="taste-provenance">
        <ShieldCheck size={19} />
        <p>
          <strong>Demo data only.</strong> Other personas cannot see your
          transactions. The server processes encrypted stored inputs; it is not
          blind to them. Deterministic processing is not a real AI or Elastic
          integration.
        </p>
      </div>
      {loading && <p role="status">Loading your private purchase workspace…</p>}
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() => void act(load)}
            disabled={busy}
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}
      {profile && capabilities && evidence && (
        <>
          {path === "/taste/connect" && (
            <div className="planning-layout">
              <section className="panel form-stack">
                <h2>Start with a fictional history.</h2>
                <p>
                  Choose a labeled dataset. Review it privately, exclude
                  anything that does not represent an interest, and explicitly
                  publish your approved summary. Gifts, work/shared purchases,
                  transfers, refunds, sensitive and ambiguous events are
                  excluded.
                </p>
                <label>
                  Fictional dataset
                  <select
                    value={dataset}
                    onChange={(e) => setDataset(e.target.value)}
                  >
                    {capabilities.datasets.map((d: Row) => (
                      <option value={d.id} key={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!profile.consent.purposes.matching ? (
                  <>
                    <p>
                      Purchase-interest matching is off until you choose that
                      purpose.
                    </p>
                    <Link href="/taste/consent" className="button">
                      Choose data permissions <ArrowRight size={16} />
                    </Link>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const job = await api("/taste/demo-imports", "POST", {
                          datasetId: dataset,
                          idempotencyKey: crypto.randomUUID(),
                          consentVersion: profile.consent.version,
                        });
                        setNotice(
                          "Fictional import processed. No PayPal data was requested.",
                        );
                        router.push(`/taste/imports/${job.id}`);
                      })
                    }
                  >
                    Import synthetic history
                  </button>
                )}
                <Link href="/profile/edit" className="text-link">
                  Prefer to declare interests yourself? <ArrowRight size={15} />
                </Link>
              </section>
              <aside className="form-stack">
                <div className="note-card lavender">
                  <h2>Three separate things.</h2>
                  <p>
                    PayPal account login, purchase-interest evidence and
                    payments are different capabilities. A payment or login
                    never grants access to a buyer’s complete history.
                  </p>
                </div>
                <div className="panel">
                  <h3>Real sync and export uploads are unavailable</h3>
                  <p>
                    They need verified account scope, approved purpose and
                    provider terms. No user credentials, CSV workaround or
                    environment flag bypass is provided.
                  </p>
                  <span className="pill">History integration unavailable</span>
                </div>
              </aside>
            </div>
          )}
          {path === "/taste/consent" && (
            <form
              className="panel form-stack settings"
              onSubmit={submit(async () => {
                await api("/taste/consents", "POST", {
                  expectedVersion: profile.consent.version,
                  purposes,
                  families,
                });
                setNotice(
                  "Your separate data purposes are saved. No purpose was inferred from login, payment or terms.",
                );
              })}
            >
              <h2>Permission, one purpose at a time.</h2>
              <p>
                All purposes start off. Your declared profile interests remain a
                viable alternative. Changing permissions invalidates the
                previous feature version; switching matching off clears
                synthetic evidence immediately.
              </p>
              {(
                [
                  ["matching", "Use reviewed synthetic purchases for matching"],
                  [
                    "publicTags",
                    "Allow selected broad tags in public match explanations",
                  ],
                  [
                    "hostedAI",
                    "Allow approved synthetic summaries for a configured hosted AI (currently unavailable)",
                  ],
                  [
                    "commercial",
                    "Allow optional commercial recommendations (currently unavailable)",
                  ],
                ] as const
              ).map(([key, label]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={purposes[key]}
                    onChange={(e) =>
                      setPurposes((p) => ({ ...p, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
              <fieldset>
                <legend>Feature families you permit</legend>
                <div className="check-row">
                  {[
                    ["categories", "Activity categories"],
                    ["brands", "Reviewed brand frequency"],
                    ["rhythms", "Coarse purchase rhythms"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={families.includes(key)}
                        onChange={(e) =>
                          setFamilies((old) =>
                            e.target.checked
                              ? [...old, key]
                              : old.filter((x) => x !== key),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="muted">
                No income, debt, financial-health or availability inference.
                Unsupported families are omitted; one family is always
                insufficient evidence.
              </p>
              <button disabled={busy || families.length === 0}>
                Save separate permissions
              </button>
              <small>
                Consent version {profile.consent.version} · policy{" "}
                {profile.consent.policyVersion}
              </small>
            </form>
          )}
          {path.startsWith("/taste/imports/") && (
            <section className="panel form-stack">
              <h2>Import status</h2>
              {importStatus ? (
                <>
                  <span className="pill">
                    {importStatus.status} ·{" "}
                    {importStatus.stage.replaceAll("_", " ")}
                  </span>
                  <p>{importStatus.label}</p>
                  <div className="taste-stats">
                    <span>
                      <strong>{importStatus.received}</strong>received
                    </span>
                    <span>
                      <strong>{importStatus.deduplicated}</strong>duplicates
                      removed
                    </span>
                    <span>
                      <strong>{importStatus.usable}</strong>usable
                    </span>
                    <span>
                      <strong>{importStatus.excluded}</strong>excluded
                    </span>
                  </div>
                  <p>
                    Processing is synchronous in this prototype. The same import
                    identity is returned on an idempotent retry; no external
                    model, PayPal history or search index was called.
                  </p>
                  <Link href="/taste/review" className="button">
                    Review my fictional records <ArrowRight size={17} />
                  </Link>
                </>
              ) : (
                <p>Import unavailable or still loading.</p>
              )}
            </section>
          )}
          {path === "/taste/review" && (
            <>
              <div className="panel form-stack">
                <div className="heading-row">
                  <div>
                    <h2>Your private review.</h2>
                    <p>
                      Changes affect only this selected persona’s synthetic
                      evidence. Nothing is published by a checkbox alone.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void act(load)}
                  >
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                </div>
                <Preview profile={profile} />
                {evidence.records.length ? (
                  <>
                    <div
                      className="taste-table-wrap"
                      role="region"
                      aria-label="Scrollable private evidence review"
                      tabIndex={0}
                    >
                      <table className="taste-table">
                        <caption>
                          Owner-only fictional purchase evidence. This is not
                          PayPal transaction history.
                        </caption>
                        <thead>
                          <tr>
                            <th>Fictional merchant / provenance</th>
                            <th>Category correction</th>
                            <th>Personal, gift or work?</th>
                            <th>Use this record?</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidence.records.map((record: Row) => (
                            <tr key={record.id}>
                              <td>
                                <strong>{record.merchantRaw}</strong>
                                <small>
                                  {record.provenance} · {record.kind}
                                </small>
                                <small>
                                  {record.sourceTimezone ||
                                    "Timezone unknown — no rhythm feature"}
                                </small>
                                <small>
                                  {record.exclusionReasons.length
                                    ? record.exclusionReasons
                                        .join(", ")
                                        .replaceAll("_", " ")
                                    : "Usable for approved features"}
                                </small>
                              </td>
                              <td>
                                <label>
                                  <span className="sr-only">
                                    Category for {record.merchantRaw}{" "}
                                    {record.id}
                                  </span>
                                  <select
                                    value={record.effectiveCategory || ""}
                                    disabled={busy || record.sensitive}
                                    onChange={(e) =>
                                      void act(() =>
                                        correction(record, {
                                          category: e.target.value,
                                        }),
                                      )
                                    }
                                  >
                                    <option value="" disabled>
                                      Unknown / review
                                    </option>
                                    {Object.entries(labels).map(
                                      ([key, label]) => (
                                        <option key={key} value={key}>
                                          {label}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </label>
                                {record.sensitive && (
                                  <small>
                                    Sensitive evidence cannot be reclassified
                                    into matching.
                                  </small>
                                )}
                              </td>
                              <td>
                                <label>
                                  <span className="sr-only">
                                    Classification for {record.id}
                                  </span>
                                  <select
                                    disabled={busy}
                                    value={record.classification}
                                    onChange={(e) =>
                                      void act(() =>
                                        correction(record, {
                                          classification: e.target.value,
                                        }),
                                      )
                                    }
                                  >
                                    {[
                                      "personal",
                                      "gift",
                                      "business",
                                      "shared",
                                    ].map((x) => (
                                      <option key={x}>{x}</option>
                                    ))}
                                  </select>
                                </label>
                              </td>
                              <td>
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    checked={!record.excluded}
                                    disabled={busy}
                                    onChange={(e) =>
                                      void act(() =>
                                        correction(record, {
                                          excluded: !e.target.checked,
                                        }),
                                      )
                                    }
                                  />
                                  Included by you
                                </label>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(() =>
                                      correction(record, {
                                        excludeMerchant: true,
                                      }),
                                    )
                                  }
                                >
                                  Exclude this merchant
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted">
                      Including a row does not override sensitive, refunded,
                      ambiguous or non-purchase exclusions. Correct an unknown
                      category explicitly only if you know the fictional event’s
                      meaning.
                    </p>
                    <button
                      disabled={busy || !profile.consent.purposes.matching}
                      onClick={() =>
                        void act(async () => {
                          await api("/taste/rebuild", "POST", {
                            consentVersion: profile.consent.version,
                            expectedEvidenceVersion: evidence.evidenceVersion,
                          });
                          setNotice(
                            "Reviewed summary published. Future discovery now uses only this current permitted feature version.",
                          );
                        })
                      }
                    >
                      Publish reviewed summary
                    </button>
                    <Link href="/discover" className="text-link">
                      See how discovery changes <ArrowRight size={15} />
                    </Link>
                  </>
                ) : (
                  <div className="empty">
                    <Sparkles />
                    <h3>No purchase evidence is stored.</h3>
                    <Link className="button secondary" href="/taste/connect">
                      Choose a source
                    </Link>
                  </div>
                )}
              </div>
            </>
          )}
          {path === "/taste/profile" && (
            <div className="planning-layout">
              <section className="panel form-stack">
                <h2>Your reviewed lifestyle summary.</h2>
                <span className="pill">{profile.label}</span>
                <Preview profile={profile} />
                <p>
                  {profile.featureActive
                    ? "A current reviewed synthetic feature version can influence discovery."
                    : "Discovery uses self-declared interests until sufficient evidence is reviewed and published."}
                </p>
                <div className="tag-list">
                  {Object.keys(profile.preview.categories).map((key) => (
                    <span className="tag" key={key}>
                      {labels[key]}
                    </span>
                  ))}
                </div>
                <p>
                  Evidence grade: <strong>{profile.evidenceGrade}</strong>. This
                  describes input support, never a chance of love.
                </p>
                {profile.feature && (
                  <small>
                    Feature {profile.feature.version} ·{" "}
                    {profile.feature.algorithmVersion}
                    <br />
                    Built{" "}
                    {new Date(profile.feature.generatedAt).toLocaleString()} ·
                    expires{" "}
                    {new Date(profile.feature.expiresAt).toLocaleDateString()}
                  </small>
                )}
                <Link className="button secondary" href="/taste/review">
                  Review or correct signals
                </Link>
                <Link className="button" href="/discover">
                  Discover with my current choices
                </Link>
              </section>
              <form
                className="panel form-stack"
                onSubmit={submit(async () => {
                  await api("/taste/profile/sharing", "PATCH", {
                    consentVersion: profile.consent.version,
                    featureVersion: profile.feature?.version || 0,
                    tags: selectedTags,
                  });
                  setNotice(
                    "Only your selected supported tags can appear in mutually permitted explanations.",
                  );
                })}
              >
                <h2>Choose what can be explained.</h2>
                <p>
                  Exact transactions, amounts, merchants and dates are never
                  part of a peer explanation. Both people must opt to share the
                  same broad tag.
                </p>
                {Object.keys(profile.feature?.categories || {}).map((key) => (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(key)}
                      disabled={
                        !profile.consent.purposes.publicTags ||
                        !profile.featureActive
                      }
                      onChange={(e) =>
                        setSelectedTags((old) =>
                          e.target.checked
                            ? [...old, key]
                            : old.filter((x) => x !== key),
                        )
                      }
                    />
                    {labels[key]}
                  </label>
                ))}
                <button
                  disabled={
                    busy ||
                    !profile.consent.purposes.publicTags ||
                    !profile.featureActive
                  }
                >
                  Save shareable tags
                </button>
                {!profile.consent.purposes.publicTags && (
                  <Link href="/taste/consent" className="text-link">
                    Choose explanation consent first
                  </Link>
                )}
                <p className="muted">
                  AI: not configured. Elastic: not configured. No provider
                  invocation is claimed.
                </p>
              </form>
            </div>
          )}
          {path === "/settings/data" && (
            <section className="panel form-stack settings">
              <h2>Stop using purchase data.</h2>
              <p>
                Source: <strong>{profile.label}</strong>. Real PayPal history
                and export uploads remain unavailable. Synthetic inputs have a
                180-day demo window; published features expire in 30 days. These
                are not permissions to retain real provider data.
              </p>
              <ul>
                {Object.entries(profile.consent.purposes).map(
                  ([key, value]) => (
                    <li key={key}>
                      {key}: {value ? "allowed" : "off"}
                    </li>
                  ),
                )}
              </ul>
              <p>
                Revoking removes this persona’s synthetic imports, review rows,
                corrections, derived feature version and shared tags
                immediately. Existing matches and separately necessary payment
                receipts remain.
              </p>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (
                      !confirm(
                        "Remove this persona’s synthetic purchase data and disable all its purchase-data purposes?",
                      )
                    )
                      return;
                    await api(
                      `/taste/consents/${profile.consent.id}`,
                      "DELETE",
                      {},
                    );
                    setNotice(
                      "Synthetic purchase data and derived state removed. Future discovery uses declared interests.",
                    );
                  })
                }
              >
                <Trash2 size={17} />
                Stop using & delete synthetic data
              </button>
              <Link href="/profile/edit" className="text-link">
                Keep using self-declared interests <ArrowRight size={16} />
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function Preview({ profile }: { profile: Row }) {
  const p = profile.preview;
  return (
    <div className="taste-preview">
      <div className="taste-stats">
        <span>
          <strong>{p.usableCount}</strong>usable purchases
        </span>
        <span>
          <strong>{p.spanDays}</strong>days of coverage
        </span>
        <span>
          <strong>{p.excludedCount}</strong>excluded
        </span>
      </div>
      <p>
        {p.evidenceBased
          ? "Enough coverage for the prototype threshold. Only enabled, supported feature families may be used."
          : "Not enough evidence for purchase-based ranking. Declared interests remain available."}
      </p>
      <small>{p.threshold}</small>
      {profile.requiresRebuild && (
        <p>
          <Check size={15} />
          Review changes are private; publish a new summary to activate them.
        </p>
      )}
    </div>
  );
}
