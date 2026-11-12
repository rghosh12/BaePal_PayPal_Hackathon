"use client";
import { useEffect, useRef, useState } from "react";

type API = (url: string, method?: string, payload?: unknown) => Promise<any>;

let sdkPromise: Promise<void> | null = null;
let sdkClientId = "";
// Loaded under its own namespace: the checkout SDK uses intent=capture and the
// SDK fixes intent per script, so holds need a second instance.
function loadSdk(clientId: string) {
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;
  sdkClientId = clientId;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=USD&intent=authorize&components=buttons&disable-funding=paylater,venmo,card`;
    script.setAttribute("data-namespace", "paypalHold");
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("PayPal could not load. Check your connection and retry."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Authorization-only PayPal hold. Approval places a hold on the member's
 * PayPal funding source; the server authorizes and verifies it. Nothing is
 * charged unless the member doesn't show up.
 */
export default function PayPalHold({
  clientId,
  planId,
  api,
  onHeld,
  onMessage,
}: {
  clientId: string;
  planId: string;
  api: API;
  onHeld: () => void;
  onMessage: (text: string, isError?: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let cancelled = false;
    let buttons: any;
    loadSdk(clientId)
      .then(() => {
        const sdk = (window as any).paypalHold;
        if (cancelled || !container.current || !sdk) return;
        container.current.innerHTML = "";
        buttons = sdk.Buttons({
          style: { layout: "vertical", shape: "pill", label: "paypal", height: 45 },
          createOrder: async () => {
            const result = await api(`/date-plans/${planId}/deposit`, "POST", {});
            if (!result.orderId) throw Error("Hold unavailable");
            return result.orderId;
          },
          onApprove: async () => {
            onMessage("Approved in PayPal. Placing the hold…");
            try {
              await api(`/date-plans/${planId}/deposit/authorize`, "POST", {});
              onHeld();
            } catch (e) {
              onMessage((e as Error).message, true);
            }
          },
          onCancel: () =>
            onMessage("You cancelled. No hold was placed."),
          onError: () =>
            onMessage("PayPal reported an error. No hold was placed. Please retry.", true),
        });
        return buttons.render(container.current).then(() => {
          if (!cancelled) setState("ready");
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setState("failed");
          onMessage((e as Error).message, true);
        }
      });
    return () => {
      cancelled = true;
      try {
        buttons?.close?.();
      } catch {
        /* SDK teardown is best-effort. */
      }
    };
  }, [clientId, planId]);
  return (
    <div className="paypal-checkout">
      {state === "loading" && <p className="muted">Loading PayPal…</p>}
      {state === "failed" && <p className="muted">PayPal buttons unavailable.</p>}
      <div ref={container} aria-label="PayPal hold buttons" />
    </div>
  );
}
