"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Row = Record<string, any>;
const labels: Record<string, string> = {
  disabled: "Not connected",
  invalid: "Configuration needs attention",
  configured_unverified: "Configured · awaiting verification",
  setup_required: "Separate setup required",
};
const previews = [
  {
    operation: "explain",
    provider: "astropods",
    label: "Interest explanation",
  },
  { operation: "products", provider: "channel3", label: "Product discovery" },
  { operation: "venues", provider: "kernel", label: "Venue research" },
  {
    operation: "handoffPreview",
    provider: "zapier",
    label: "Automation preview",
  },
];
export default function IntegrationWorkspace({
  api,
}: {
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
}) {
  const [status, setStatus] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState("explain"),
    [interest, setInterest] = useState("arts"),
    [approved, setApproved] = useState(false),
    [result, setResult] = useState<Row | null>(null);
  useEffect(() => {
    let alive = true;
    api("/integrations/status")
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  const selected = previews.find((p) => p.operation === operation)!;
  const available = status?.providers
    .find((p: Row) => p.id === selected.provider)
    ?.operations.includes(operation);
  async function preview() {
    if (busy || !approved) return;
    setBusy(true);
    setError("");
    setResult(null);
    const input =
      operation === "handoffPreview"
        ? { activity: "Art", city: "Seattle" }
        : operation === "venues"
          ? { interests: [interest], city: "Seattle" }
          : operation === "explain"
            ? { interests: [interest], sharedInterests: [interest] }
            : { interests: [interest] };
    try {
      setResult(
        await api("/integrations/preview", "POST", {
          operation,
          input,
          allowExternalProcessing: true,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-stack">
      <div>
        <p className="eyebrow">Your workspace</p>
        <h1>Connected services</h1>
        <p>
          Add provider settings through the secure server environment. Keys and
          endpoint addresses stay on the server.
        </p>
      </div>
      <Link href="/settings/account">Back to account settings</Link>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        <p role="status">Loading connection status…</p>
      ) : (
        <>
          <div className="form-stack">
            {status.providers.map((p: Row) => (
              <article className="panel" key={p.id}>
                <h2>{p.label}</h2>
                <p>{labels[p.state] || p.state}</p>
                {p.operations.length > 0 && (
                  <p>Available previews: {p.operations.join(", ")}</p>
                )}
              </article>
            ))}
          </div>
          <article className="panel form-stack">
            <h2>Try a connection</h2>
            <p>
              Preview a response using one broad interest. This does not import
              purchase history, make a reservation, buy a product, or send a
              calendar invitation.
            </p>
            <label>
              Preview
              <select
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value);
                  setApproved(false);
                  setResult(null);
                }}
              >
                {previews.map((p) => (
                  <option key={p.operation} value={p.operation}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {operation !== "handoffPreview" && (
              <label>
                Interest
                <select
                  value={interest}
                  onChange={(e) => {
                    setInterest(e.target.value);
                    setApproved(false);
                    setResult(null);
                  }}
                >
                  {[
                    "books",
                    "coffee",
                    "outdoors",
                    "arts",
                    "music",
                    "games",
                  ].map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p>
              Destination:{" "}
              {
                status.providers.find((p: Row) => p.id === selected.provider)
                  ?.label
              }
              . Data:{" "}
              {operation === "handoffPreview"
                ? "Art and Seattle"
                : interest + (operation === "venues" ? " and Seattle" : "")}
              . No account identity, raw purchases, messages, or private budgets
              are included.
            </p>
            <label>
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />{" "}
              I allow this selected data to be sent to the configured service
              for this preview.
            </label>
            {!available && (
              <p>
                This service needs server configuration before a preview can
                run.
              </p>
            )}
            <button
              className="button"
              disabled={busy || !approved || !available}
              onClick={preview}
            >
              {busy ? "Requesting preview…" : "Run preview"}
            </button>
            {result && (
              <div role="status">
                <h3>Provider preview</h3>
                <p>
                  Review external suggestions before acting. Availability and
                  prices are not verified.
                </p>
                {result.data.summary && <p>{result.data.summary}</p>}
                {result.data.destination && <p>{result.data.destination}</p>}
                {(result.data.items || result.data.venues || []).map(
                  (x: Row, i: number) => (
                    <p key={i}>
                      <a href={x.url} target="_blank" rel="noreferrer noopener">
                        {x.title || x.name}
                      </a>
                      {x.description && " · " + x.description}
                    </p>
                  ),
                )}
                <p>
                  Response received through the configured gateway. Native
                  provider verification remains separate.
                </p>
              </div>
            )}
          </article>
          <p>
            Configuration instructions:{" "}
            <a
              href="https://github.com/rghosh12/BaePal_PayPal_Hackathon/blob/main/docs/INTEGRATIONS.md"
              target="_blank"
              rel="noreferrer noopener"
            >
              secure integration setup
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}
