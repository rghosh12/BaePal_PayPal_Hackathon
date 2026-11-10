-- Signed but not yet correlatable notifications remain durable and bounded.
ALTER TABLE webhook_inbox
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text,
  ADD COLUMN processed_at timestamptz;
ALTER TABLE webhook_inbox ADD CONSTRAINT webhook_inbox_state_check
  CHECK(state IN ('pending','processed','quarantined'));
CREATE INDEX webhook_inbox_due ON webhook_inbox(available_at,created_at,event_id)
  WHERE state='pending';
