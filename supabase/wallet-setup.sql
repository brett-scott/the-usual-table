-- The Usual Table: run this complete file in Supabase SQL Editor.
-- Safe to rerun on the version-1 wallet schema; preserves balances and history.
-- New wallet accounts receive one 10,000-chip welcome grant. No purchases or cash value.
-- Daily grants and funded browser gameplay remain disabled.
BEGIN;
DO $install$
BEGIN
  IF to_regnamespace('wallet_private') IS NULL THEN
    EXECUTE $wallet_schema$
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
$wallet_schema$;
  ELSE
    IF to_regclass('wallet_private.schema_version') IS NULL THEN
      RAISE EXCEPTION 'An unrecognized wallet_private schema exists; inspect it before continuing';
    END IF;
    IF (SELECT count(*) FROM wallet_private.schema_version WHERE version = 1) <> 1
      OR (SELECT count(*) FROM wallet_private.schema_version) <> 1 THEN
      RAISE EXCEPTION 'Unsupported wallet schema version';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['accounts','wallets','sessions','operations','ledger','grant_claims','results']) name
      WHERE to_regclass('wallet_private.' || name) IS NULL) THEN
      RAISE EXCEPTION 'Wallet storage is incomplete; restore it rather than resetting balances';
    END IF;
  END IF;
END;
$install$;

-- Run after 001_wallet.sql. The private tables remain outside the exposed API.
-- These functions accept no account IDs, amounts, rewards or client wallet state.
CREATE OR REPLACE FUNCTION wallet_private.social_account_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := auth.uid();
  claims jsonb := auth.jwt();
BEGIN
  IF account IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR coalesce(claims ->> 'is_anonymous', 'false') <> 'false'
    OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = account
      AND coalesce(u.is_anonymous, false) = false
      AND u.raw_app_meta_data ->> 'provider' IN ('google', 'discord'))
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(claims -> 'amr', '[]'::jsonb)) m WHERE m ->> 'method' = 'oauth')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(claims -> 'amr', '[]'::jsonb)) m WHERE m ->> 'method' IN ('password', 'otp', 'anonymous')) THEN
    RAISE EXCEPTION 'A current social account is required' USING ERRCODE = '42501';
  END IF;
  RETURN account;
END;
$$;

CREATE OR REPLACE FUNCTION public.usual_table_wallet_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := wallet_private.social_account_id();
  summary jsonb;
BEGIN
  SELECT jsonb_build_object(
    'contract', 1, 'currency', 'virtual-chips', 'unitsPerChip', 100,
    'accountId', a.account_id, 'status', a.status, 'version', w.version,
    'availableUnits', w.available_units,
    'atTablesUnits', coalesce(sum(s.stack_units) FILTER (WHERE s.state IN ('pending_activation', 'active')), 0),
    'pendingReturnUnits', coalesce(sum(s.stack_units) FILTER (WHERE s.state = 'returning'), 0))
  INTO summary
  FROM wallet_private.accounts a JOIN wallet_private.wallets w USING (account_id)
  LEFT JOIN wallet_private.sessions s USING (account_id)
  WHERE a.account_id = account GROUP BY a.account_id, w.account_id;
  RETURN summary; -- NULL means no saved wallet has been provisioned; never fabricate a balance.
END;
$$;

CREATE OR REPLACE FUNCTION public.usual_table_ensure_wallet()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := wallet_private.social_account_id();
  created uuid;
  summary jsonb;
BEGIN
  INSERT INTO wallet_private.accounts (account_id) VALUES (account)
    ON CONFLICT DO NOTHING RETURNING account_id INTO created;
  IF created IS NOT NULL THEN
    INSERT INTO wallet_private.wallets (account_id) VALUES (account); -- Starts at zero; no grant/refill.
  END IF;
  summary := public.usual_table_wallet_summary();
  IF summary IS NULL THEN
    RAISE EXCEPTION 'Wallet storage is incomplete'; -- Fail without resetting an existing account.
  END IF;
  RETURN summary;
END;
$$;

REVOKE ALL ON SCHEMA wallet_private FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA wallet_private FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wallet_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usual_table_wallet_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.usual_table_ensure_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usual_table_wallet_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.usual_table_ensure_wallet() TO authenticated;
NOTIFY pgrst, 'reload schema';

-- Approved new-player grant: 10,000 virtual chips = 1,000,000 wallet units.
-- Only a newly created wallet account receives it. Existing funds are never reset or topped up.
CREATE OR REPLACE FUNCTION public.usual_table_ensure_wallet()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := wallet_private.social_account_id();
  created uuid;
  operation uuid;
  summary jsonb;
BEGIN
  INSERT INTO wallet_private.accounts (account_id) VALUES (account)
    ON CONFLICT DO NOTHING RETURNING account_id INTO created;
  IF created IS NOT NULL THEN
    operation := gen_random_uuid();
    INSERT INTO wallet_private.wallets (account_id, available_units, version) VALUES (account, 1000000, 1);
    summary := public.usual_table_wallet_summary();
    INSERT INTO wallet_private.grant_claims (account_id, operation_id, source, amount_units, policy_version)
      VALUES (account, operation, 'welcome', 1000000, 'welcome-v1-10000');
    INSERT INTO wallet_private.ledger (account_id, operation_id, kind, session_id, available_delta,
      table_delta, available_after, stack_after, policy_version, wallet_version)
      VALUES (account, operation, 'claim_grant', NULL, 1000000, 0, 1000000, NULL, 'welcome-v1-10000', 1);
    INSERT INTO wallet_private.operations (account_id, operation_id, request, receipt)
      VALUES (account, operation,
        jsonb_build_object('contract', 1, 'accountId', account, 'operationId', operation, 'kind', 'claim_grant', 'source', 'welcome'),
        jsonb_build_object('operationId', operation, 'wallet', summary, 'session', NULL));
  ELSE
    summary := public.usual_table_wallet_summary();
  END IF;
  IF summary IS NULL THEN
    RAISE EXCEPTION 'Wallet storage is incomplete';
  END IF;
  RETURN summary;
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_ensure_wallet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usual_table_ensure_wallet() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
