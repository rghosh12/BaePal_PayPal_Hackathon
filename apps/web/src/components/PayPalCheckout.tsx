"use client";
import { useEffect, useRef, useState } from "react";

type API = (url: string, method?: string, payload?: unknown) => Promise<any>;

declare global {
  interface Window {
    paypal?: any;
  }
}

let sdkPromise: Promise<void> | null = null;
let sdkClientId = "";
function loadSdk(clientId: string) {
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;
  sdkClientId = clientId;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    // Official PayPal JavaScript SDK. Only the public client ID reaches the browser.
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=USD&intent=capture&components=buttons&disable-funding=paylater,venmo`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("PayPal checkout could not load. Check your connection and retry."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Official PayPal Smart Buttons (Sandbox). The server creates the order from
 * the accepted plan snapshot and captures + verifies it after approval.
 * onApprove alone is never treated as payment evidence.
 */
export default function PayPalCheckout({
  clientId,
  paymentId,
  api,
  onCaptured,
  onMessage,
}: {
  clientId: string;
  paymentId: string;
  api: API;
  onCaptured: () => void;
  onMessage: (text: string, isError?: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let cancelled = false;
    let buttons: any;
    loadSdk(clientId)
      .then(() => {
        if (cancelled || !container.current || !window.paypal) return;
        container.current.innerHTML = "";
        buttons = window.paypal.Buttons({
          style: { layout: "vertical", shape: "pill", label: "pay", height: 45 },
          createOrder: async () => {
            const result = await api("/payments/orders", "POST", { paymentId });
            if (!result.orderId) throw Error("Order unavailable");
            return result.orderId;
          },
          onApprove: async () => {
            onMessage("Approved in PayPal. Verifying and capturing on the server…");
            try {
              await api(`/payments/${paymentId}/capture`, "POST", {});
              onCaptured();
            } catch (e) {
              onMessage((e as Error).message, true);
            }
          },
          onCancel: () =>
            onMessage(
              "You cancelled PayPal approval. No payment was taken; you can try again anytime.",
            ),
          onError: () =>
            onMessage(
              "PayPal reported an error. No payment is assumed. Retry, or use the redirect option.",
              true,
            ),
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
    // Callbacks are intentionally read once per rendered button set.
  }, [clientId, paymentId]);
  return (
    <div className="paypal-checkout">
      {state === "loading" && <p className="muted">Loading PayPal checkout…</p>}
      {state === "failed" && (
        <p className="muted">PayPal buttons unavailable — use the redirect option below.</p>
      )}
      <div ref={container} aria-label="PayPal checkout buttons" />
    </div>
  );
}
