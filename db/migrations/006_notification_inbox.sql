-- In-app inbox: events reference the match they belong to so closed or blocked
-- matches stop surfacing dating content to the former partner.
ALTER TABLE notifications ADD COLUMN match_id uuid REFERENCES matches;
CREATE INDEX notifications_inbox ON notifications(user_id,created_at DESC);
