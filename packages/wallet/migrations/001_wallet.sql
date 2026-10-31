BEGIN;
-- Deliberately outside public / the Supabase Data API. Provision only in the account phase.
CREATE SCHEMA wallet_private;
REVOKE ALL ON SCHEMA wallet_private FROM PUBLIC;

CREATE TABLE wallet_private.schema_version (version integer PRIMARY KEY CHECK (version = 1));
INSERT INTO wallet_private.schema_version VALUES (1);

CREATE TABLE wallet_private.accounts (
  account_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TABLE wallet_private.wallets (
  account_id uuid PRIMARY KEY REFERENCES wallet_private.accounts(account_id),
  available_units bigint NOT NULL DEFAULT 0 CHECK (available_units BETWEEN 0 AND 9000000000000),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE wallet_private.sessions (
  session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES wallet_private.accounts(account_id),
  room_id text NOT NULL CHECK (length(room_id) BETWEEN 1 AND 100),
  game_id text NOT NULL CHECK (game_id IN ('blackjack', 'baccarat', 'roulette', 'texas-holdem', 'keno', 'duck-race', 'penguin-cross', 'crash')),
  funding text NOT NULL DEFAULT 'account' CHECK (funding = 'account'),
  state text NOT NULL CHECK (state IN ('pending_activation', 'active', 'returning', 'closed', 'cancelled')),
  stack_units bigint NOT NULL CHECK (stack_units BETWEEN 0 AND 9000000000000),
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  result_sequence bigint NOT NULL DEFAULT 0 CHECK (result_sequence BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (state NOT IN ('closed', 'cancelled') OR stack_units = 0),
  UNIQUE (account_id, session_id)
);
CREATE UNIQUE INDEX one_live_seat_per_account_room ON wallet_private.sessions(account_id, room_id)
  WHERE state NOT IN ('closed', 'cancelled');
CREATE INDEX account_sessions ON wallet_private.sessions(account_id, state);

CREATE TABLE wallet_private.operations (
  account_id uuid NOT NULL REFERENCES wallet_private.accounts(account_id),
  operation_id uuid NOT NULL,
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (account_id, operation_id)
);
CREATE TABLE wallet_private.ledger (
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('claim_grant', 'allocate', 'activate', 'cancel_allocation', 'settle', 'request_return', 'complete_return')),
  session_id uuid,
  available_delta bigint NOT NULL CHECK (available_delta BETWEEN -9000000000000 AND 9000000000000),
  table_delta bigint NOT NULL CHECK (table_delta BETWEEN -9000000000000 AND 9000000000000),
  available_after bigint NOT NULL CHECK (available_after BETWEEN 0 AND 9000000000000),
  stack_after bigint CHECK (stack_after BETWEEN 0 AND 9000000000000),
  wallet_version bigint NOT NULL CHECK (wallet_version BETWEEN 1 AND 9007199254740991),
  policy_version text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (account_id, operation_id),
  UNIQUE (account_id, wallet_version),
  FOREIGN KEY (account_id, operation_id) REFERENCES wallet_private.operations(account_id, operation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (account_id, session_id) REFERENCES wallet_private.sessions(account_id, session_id)
);
CREATE TABLE wallet_private.grant_claims (
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('welcome', 'daily')),
  amount_units bigint NOT NULL CHECK (amount_units BETWEEN 1 AND 9000000000000),
  policy_version text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  next_eligible_at timestamptz,
  PRIMARY KEY (account_id, operation_id),
  FOREIGN KEY (account_id, operation_id) REFERENCES wallet_private.operations(account_id, operation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX one_welcome_per_account ON wallet_private.grant_claims(account_id) WHERE source = 'welcome';
CREATE INDEX allowance_history ON wallet_private.grant_claims(account_id, source, claimed_at DESC);
CREATE TABLE wallet_private.results (
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  round_id text NOT NULL CHECK (length(round_id) BETWEEN 1 AND 100),
  ruleset_version text NOT NULL CHECK (length(ruleset_version) BETWEEN 1 AND 100),
  wagered_units bigint NOT NULL CHECK (wagered_units BETWEEN 1 AND 9000000000000),
  returned_units bigint NOT NULL CHECK (returned_units BETWEEN 0 AND 9000000000000),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (session_id, sequence),
  UNIQUE (session_id, round_id),
  UNIQUE (account_id, operation_id),
  FOREIGN KEY (account_id, session_id) REFERENCES wallet_private.sessions(account_id, session_id),
  FOREIGN KEY (account_id, operation_id) REFERENCES wallet_private.operations(account_id, operation_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION wallet_private.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wallet history is append-only';
END;
$$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON wallet_private.ledger FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
CREATE TRIGGER immutable_results BEFORE UPDATE OR DELETE ON wallet_private.results FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
CREATE TRIGGER immutable_operations BEFORE UPDATE OR DELETE ON wallet_private.operations FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
CREATE TRIGGER immutable_claims BEFORE UPDATE OR DELETE ON wallet_private.grant_claims FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();

-- No client policies. Only the future trusted backend role may use these tables.
ALTER TABLE wallet_private.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.grant_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA wallet_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wallet_private FROM PUBLIC;
COMMIT;
