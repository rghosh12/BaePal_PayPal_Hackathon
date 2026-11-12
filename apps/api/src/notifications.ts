import { createHash, randomUUID } from "node:crypto";
import { one, type Conn } from "./db.js";

export const NOTIFICATION_TITLES: Record<string, string> = {
  "match.created": "You have a new match.",
  "message.received": "You have a new message.",
  "date.proposed": "A date plan needs your review.",
  "date.confirmed": "A date plan is confirmed.",
  "payment.completed": "Your PayPal payment completed.",
  "refund.completed": "Your PayPal refund completed.",
  "deposit.held": "Your match placed their no-show hold.",
  "deposit.released": "You both checked in. Both holds were released.",
  "deposit.captured": "Your no-show hold was captured.",
  "deposit.compensated": "Your match didn't show. Their hold is being paid out to you.",
  "account.warning":
    "BaePal safety reviewed a report about your account. Please review our community guidelines.",
};

// Replays of the same domain event map to the same event_id, so the
// UNIQUE(user_id,event_id) constraint deduplicates them.
export function eventId(key: string) {
  const h = createHash("sha256").update(`baepal-event:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function notify(
  c: Conn,
  recipients: string[],
  key: string,
  category: keyof typeof NOTIFICATION_TITLES,
  matchId: string | null,
) {
  const event = eventId(key);
  for (const uid of recipients)
    await c.query(
      "INSERT INTO notifications(id,user_id,event_id,category,match_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [randomUUID(), uid, event, category, matchId],
    );
}

export async function matchMembers(c: Conn, matchId: string) {
  const m = await one(c, "SELECT low_id,high_id FROM matches WHERE id=$1", [
    matchId,
  ]);
  return m ? [m.low_id as string, m.high_id as string] : [];
}

export async function inbox(c: Conn, user: string) {
  const rows = (
    await c.query(
      `SELECT n.id,n.category,n.match_id,n.read_at,n.created_at FROM notifications n
       LEFT JOIN matches m ON m.id=n.match_id
       WHERE n.user_id=$1 AND (n.match_id IS NULL OR m.status='active' OR n.category IN ('payment.completed','refund.completed','deposit.captured','deposit.compensated'))
       ORDER BY n.created_at DESC LIMIT 50`,
      [user],
    )
  ).rows;
  return {
    items: rows.map((n) => ({
      id: n.id,
      category: n.category,
      title: NOTIFICATION_TITLES[n.category] ?? "You have an update.",
      matchId: /^(payment|refund|deposit)\./.test(n.category) ? null : n.match_id,
      read: !!n.read_at,
      createdAt: n.created_at,
    })),
    unread: rows.filter((n) => !n.read_at).length,
  };
}
