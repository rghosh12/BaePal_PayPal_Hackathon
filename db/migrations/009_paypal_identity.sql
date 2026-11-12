-- Log in with PayPal link: one PayPal account per member. The email is kept
-- encrypted and only used as the member's own no-show payout destination.
CREATE TABLE paypal_identities(
  user_id uuid PRIMARY KEY REFERENCES users,
  payer_id text UNIQUE NOT NULL,
  verified boolean NOT NULL,
  email_encrypted text,
  mode text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
