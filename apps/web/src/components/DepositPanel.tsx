"use client";
import { useState } from "react";
import { ShieldCheck, LoaderCircle } from "lucide-react";
import PayPalHold from "./PayPalHold";

type Row = Record<string, any>;
type API = (url: string, method?: string, payload?: unknown) => Promise<any>;

const label: Record<string, string> = {
  none: "no hold yet",
  created: "waiting for PayPal approval",
  authorized: "hold placed",
  voided: "released",
  captured: "captured",
  failed: "failed",
};

/** No-show protection: authorize → (both check in → void) | (no-show → capture + payout). */
export default function DepositPanel({
  planId,
  d,
  config,
  api,
  busy,
  act,
  refresh,
  setNotice,
  setError,
}: {
  planId: string;
  d: Row;
  config: Row;
  api: API;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void> | void;
  refresh: () => Promise<void>;
  setNotice: (s: string) => void;
  setError: (s: string) => void;
}) {
  const [email, setEmail] = useState("");
  const amount = `$${(d.amountCents / 100).toFixed(0)}`;
  const sandbox = d.mode === "sandbox" && config.paypalClientId;
  const btn = (text: string, fn: () => Promise<void>, kind = "primary") => (
    <button className={kind} disabled={busy} onClick={() => void act(fn)}>
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {text}
    </button>
  );
  const settled = ["voided", "captured"].includes(d.you.state) || d.payout;
  return (
    <div className="panel deposit-panel">
      <span className="eyebrow">
        <ShieldCheck size={14} aria-hidden /> NO-SHOW PROTECTION · PAYPAL
      </span>
      <h2>Protect this date with a {amount} hold.</h2>
      <p className="muted">
        Each of you authorizes a {amount} PayPal hold. Nothing is charged. If you
        both check in, both holds are released. If one person doesn&apos;t show,
        their hold is captured and paid out to the person who did.
      </p>
      <dl>
        <div>
          <dt>Your hold</dt>
          <dd>
            {label[d.you.state] || d.you.state}
            {d.you.checkedIn ? " · checked in" : ""}
          </dd>
        </div>
        <div>
          <dt>Their hold</dt>
          <dd>
            {label[d.partner.state] || d.partner.state}
            {d.partner.checkedIn ? " · checked in" : ""}
          </dd>
        </div>
      </dl>
      {d.payout && (
        <p className="saved">
          {d.payout.toYou
            ? `Your match didn't show. ${amount} PayPal payout sent to you${d.payout.batchId ? ` (batch ${d.payout.batchId})` : ""}.`
            : `You were marked as a no-show. Your ${amount} hold was captured.`}
        </p>
      )}
      {d.you.state === "voided" && !d.payout && (
        <p className="saved">You both showed up. Both holds were released. Nobody paid anything.</p>
      )}
      {!settled && ["none", "created"].includes(d.you.state) &&
        (sandbox ? (
          <PayPalHold
            clientId={config.paypalClientId}
            planId={planId}
            api={api}
            onHeld={() => {
              setNotice(`Your ${amount} hold is placed. Nothing was charged.`);
              void refresh();
            }}
            onMessage={(t, isError) => (isError ? setError(t) : setNotice(t))}
          />
        ) : (
          btn(`Place ${amount} mock hold`, async () => {
            await api(`/date-plans/${planId}/deposit`, "POST", {});
            await api(`/date-plans/${planId}/deposit/authorize`, "POST", {});
            setNotice(`Mock ${amount} hold placed. Nothing was charged.`);
            await refresh();
          })
        ))}
      {!settled && d.you.state === "authorized" && !d.you.checkedIn &&
        btn("I'm here — check in", async () => {
          const r = await api(`/date-plans/${planId}/check-in`, "POST", {});
          setNotice(
            r.you.state === "voided"
              ? "You both checked in. Both holds released. Enjoy your date!"
              : "Checked in. Waiting for your match.",
          );
          await refresh();
        })}
      {!settled && d.you.checkedIn && d.partner.state === "authorized" && !d.partner.checkedIn && (
        <div className="form-stack">
          {d.mode === "sandbox" && d.payoutEmailOnFile && (
            <p className="muted">Payout goes to the PayPal account you linked.</p>
          )}
          {d.mode === "sandbox" && !d.payoutEmailOnFile && (
            <label>
              PayPal email for your payout
              <input
                type="email"
                value={email}
                placeholder="your-sandbox-buyer@personal.example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {btn(
            "They didn't show — claim their hold",
            async () => {
              if (!confirm("Report a no-show? Their hold will be captured and paid out to you."))
                return;
              await api(`/date-plans/${planId}/no-show`, "POST", email ? { payoutEmail: email } : {});
              setNotice("No-show recorded. Their hold was captured and a PayPal payout is on its way to you.");
              await refresh();
            },
            "danger",
          )}
        </div>
      )}
      {d.demoClock && !settled && (
        <p className="muted small">
          Demo mode: check-in and no-show claims are allowed before the scheduled time so the
          full flow fits in a walkthrough.
        </p>
      )}
    </div>
  );
}
