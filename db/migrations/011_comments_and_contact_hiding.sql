-- #17: a like can carry one comment on a specific prompt or photo. The
-- snapshot is what the commenter saw; it is shown only while it still
-- matches the recipient's current profile.
CREATE TABLE IF NOT EXISTS like_comments (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prompt', 'photo')),
  position int NOT NULL CHECK (position >= 0),
  snapshot jsonb NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, target_id)
);
CREATE INDEX IF NOT EXISTS like_comments_target ON like_comments(target_id);

-- #19: members hide specific contacts by email. Only keyed hashes are stored;
-- no address book is uploaded.
CREATE TABLE IF NOT EXISTS contact_hides (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_hash)
);
CREATE INDEX IF NOT EXISTS contact_hides_hash ON contact_hides(contact_hash);
