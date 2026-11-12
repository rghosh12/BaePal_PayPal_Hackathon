import { config } from "../config.js";

const API = "https://api-m.sandbox.paypal.com";
const WEB = "https://www.sandbox.paypal.com";
export const PAYPAL_SCOPES =
  "openid email https://uri.paypal.com/services/paypalattributes";
export const paypalRedirectUri = () =>
  `${config.APP_ORIGIN}/api/v1/auth/paypal/callback`;

export function authorizeUrl(state: string) {
  const q = new URLSearchParams({
    flowEntry: "static",
    client_id: config.PAYPAL_CLIENT_ID || "",
    response_type: "code",
    scope: PAYPAL_SCOPES,
    redirect_uri: paypalRedirectUri(),
    state,
  });
  return `${WEB}/signin/authorize?${q}`;
}

export type PayPalIdentity = {
  payerId: string;
  verified: boolean;
  email: string | null;
};

// Authorization-code exchange and userinfo. Only the payer ID, the verified
// flag and the primary email are kept; tokens are discarded immediately.
export async function identityFromCode(code: string): Promise<PayPalIdentity> {
  const basic = Buffer.from(
    `${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const tokenRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
    }).toString(),
    signal: AbortSignal.timeout(12000),
  });
  if (!tokenRes.ok) {
    console.error(
      JSON.stringify({ paypal: { op: "identity-token", status: tokenRes.status } }),
    );
    throw Error("PayPal sign-in could not be completed.");
  }
  const { access_token } = (await tokenRes.json()) as any;
  const infoRes = await fetch(
    `${API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!infoRes.ok) {
    console.error(
      JSON.stringify({ paypal: { op: "identity-userinfo", status: infoRes.status } }),
    );
    throw Error("PayPal profile unavailable.");
  }
  const info = (await infoRes.json()) as any;
  const payerId = info.payer_id || info.user_id;
  if (!payerId) throw Error("PayPal profile unavailable.");
  const email =
    info.emails?.find((e: any) => e.primary)?.value ??
    info.emails?.[0]?.value ??
    info.email ??
    null;
  return {
    payerId: String(payerId),
    verified: info.verified_account === true || info.verified_account === "true",
    email,
  };
}
