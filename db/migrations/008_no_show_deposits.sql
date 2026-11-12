-- No-show protection: each member places an authorization-only hold for a
-- specific accepted plan version. Holds are voided when both check in, or the
-- absent member's hold is captured and paid out to the member who showed up.
CREATE TABLE date_deposits(
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES date_plans,
  version integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users,
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  mode text NOT NULL,
  order_id text UNIQUE,
  authorization_id text UNIQUE,
  capture_id text UNIQUE,
  state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','authorized','voided','captured','failed')),
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version,user_id)
);
CREATE TABLE deposit_payouts(
  id uuid PRIMARY KEY,
  deposit_id uuid UNIQUE NOT NULL REFERENCES date_deposits,
  recipient_id uuid NOT NULL REFERENCES users,
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  batch_id text UNIQUE,
  state text NOT NULL DEFAULT 'requested',
  created_at timestamptz NOT NULL DEFAULT now()
);
