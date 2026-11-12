-- Moderator decisions carry an optimistic version and the last action taken.
ALTER TABLE reports
  ADD COLUMN version integer NOT NULL DEFAULT 0,
  ADD COLUMN action text CHECK(action IN ('dismiss','warn','suspend','restore','escalate')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX reports_subject ON reports(subject_id);
