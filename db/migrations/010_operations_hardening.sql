-- Durable auth throttles keyed by HMAC'd account/network identifiers; they
-- survive restarts and are shared by every API process.
CREATE TABLE auth_throttle(
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0
);

-- Transactional email outbox. Recipient and template data are encrypted;
-- subjects are fixed per template and never contain dating content.
CREATE TABLE email_outbox(
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  template text NOT NULL,
  to_encrypted text NOT NULL,
  data_encrypted text,
  dedupe_key text UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','dead','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_outbox_due ON email_outbox(available_at) WHERE state='pending';

-- Session management: stable public id, creation time and a coarse device label.
ALTER TABLE sessions
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN device text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX sessions_public_id ON sessions(id);
CREATE INDEX sessions_user ON sessions(user_id);

-- Compensation jobs: leases, last error and a dead-letter state for review.
ALTER TABLE outbox
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN dead_at timestamptz;

-- Media moderation lifecycle. Existing rows predate moderation and stay approved.
ALTER TABLE media
  ADD COLUMN state text NOT NULL DEFAULT 'approved' CHECK(state IN ('pending','approved','rejected')),
  ADD COLUMN reason text,
  ADD COLUMN reviewed_at timestamptz;
CREATE INDEX media_owner ON media(owner_id,created_at);

-- Bounded partial refunds alongside the single cancellation refund.
ALTER TABLE refunds DROP CONSTRAINT refunds_payment_id_key;
ALTER TABLE refunds
  ADD COLUMN kind text NOT NULL DEFAULT 'cancellation' CHECK(kind IN ('cancellation','partial')),
  ADD COLUMN reason text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX refunds_cancellation ON refunds(payment_id) WHERE kind='cancellation';
CREATE INDEX refunds_payment ON refunds(payment_id);

-- Discovery eligibility query.
CREATE INDEX users_discoverable ON users(id) WHERE status='active' AND role='member';
CREATE INDEX profiles_city ON profiles(city);
CREATE INDEX blocks_target ON blocks(target_id,actor_id);

-- Undo window for the latest pass.
ALTER TABLE decisions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Explicit declines of a specific proposal version.
CREATE TABLE proposal_declines(
  plan_id uuid NOT NULL REFERENCES date_plans,
  version integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id,version,user_id)
);

-- Catalogue facts used as hard filters, with provenance.
ALTER TABLE catalogue
  ADD COLUMN neighborhood text NOT NULL DEFAULT '',
  ADD COLUMN step_free boolean NOT NULL DEFAULT false,
  ADD COLUMN opens_minute integer NOT NULL DEFAULT 0 CHECK(opens_minute BETWEEN 0 AND 1440),
  ADD COLUMN closes_minute integer NOT NULL DEFAULT 1440 CHECK(closes_minute BETWEEN 0 AND 1440),
  ADD COLUMN source text NOT NULL DEFAULT 'Fictional demo catalogue (BaePal seed)';
ALTER TABLE private_date_preferences
  ADD COLUMN step_free boolean NOT NULL DEFAULT false,
  ADD COLUMN neighborhoods text[] NOT NULL DEFAULT '{}',
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Los_Angeles';

-- Opt-in chat read watermarks and member privacy settings.
CREATE TABLE read_watermarks(
  match_id uuid NOT NULL REFERENCES matches,
  user_id uuid NOT NULL REFERENCES users,
  sequence integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,user_id)
);
CREATE TABLE member_settings(
  user_id uuid PRIMARY KEY REFERENCES users,
  read_receipts boolean NOT NULL DEFAULT false,
  typing_indicators boolean NOT NULL DEFAULT true,
  email_updates boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One-time Sandbox planning pass (not a subscription).
CREATE TABLE entitlements(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users,
  product text NOT NULL CHECK(product IN ('planning_pass')),
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  mode text NOT NULL,
  order_id text UNIQUE,
  capture_id text UNIQUE,
  refund_id text UNIQUE,
  state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','approval_pending','active','refunded','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entitlements_one_active ON entitlements(user_id,product) WHERE state IN ('created','approval_pending','active');

-- Optional professional connections. Proves account control only; hidden
-- unless the member chooses to show it.
CREATE TABLE connections(
  user_id uuid NOT NULL REFERENCES users,
  provider text NOT NULL CHECK(provider IN ('github','linkedin')),
  subject text NOT NULL,
  label text NOT NULL DEFAULT '',
  visible boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,provider),
  UNIQUE(provider,subject)
);

-- Appeals against moderation actions.
CREATE TABLE appeals(
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users,
  report_id uuid REFERENCES reports,
  text varchar(2000) NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','upheld','overturned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
