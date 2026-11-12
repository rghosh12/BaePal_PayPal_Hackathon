import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, one, type Conn } from "./db.js";
export const MessageCreatedEvent = z
  .object({
    eventId: z.uuid(),
    schemaVersion: z.literal(1),
    aggregateId: z.uuid(),
    timestamp: z.iso.datetime(),
    type: z.literal("message.created"),
    payload: z
      .object({ messageId: z.uuid(), sequence: z.number().int().positive() })
      .strict(),
  })
  .strict();
export function messageEventEnvelope(row: any) {
  const parsed = MessageCreatedEvent.safeParse({
    eventId: row.event_id,
    schemaVersion: row.schema_version,
    aggregateId: row.conversation_id,
    timestamp:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : row.occurred_at,
    type: row.event_type,
    payload: { messageId: row.message_id, sequence: row.sequence },
  });
  if (!parsed.success)
    throw Error("Stored chat event does not match its contract.");
  return parsed.data;
}
export async function persistMessageEvent(c: Conn, message: any) {
  await c.query(
    "INSERT INTO chat_message_events(event_id,message_id,conversation_id,sequence,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING",
    [
      randomUUID(),
      message.id,
      message.match_id,
      message.sequence,
      message.created_at,
    ],
  );
}
export async function eventForMessage(messageId: string) {
  const row = await one(
    db,
    "SELECT * FROM chat_message_events WHERE message_id=$1",
    [messageId],
  );
  if (!row) throw Error("Stored chat event is unavailable.");
  return messageEventEnvelope(row);
}
