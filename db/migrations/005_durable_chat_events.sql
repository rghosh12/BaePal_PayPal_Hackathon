-- Metadata-only replay log; dating text remains solely in messages.
CREATE TABLE chat_message_events(
  event_id uuid PRIMARY KEY,
  message_id uuid NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES matches(id),
  sequence integer NOT NULL CHECK(sequence>0),
  event_type text NOT NULL DEFAULT 'message.created' CHECK(event_type='message.created'),
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1),
  occurred_at timestamptz NOT NULL,
  UNIQUE(conversation_id,sequence)
);
-- Backfill stable event identity for history that predates this migration.
INSERT INTO chat_message_events(event_id,message_id,conversation_id,sequence,occurred_at)
SELECT gen_random_uuid(),id,match_id,sequence,created_at FROM messages
ON CONFLICT(message_id) DO NOTHING;
