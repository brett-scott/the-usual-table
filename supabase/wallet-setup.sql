-- The Usual Table: run this complete file in Supabase SQL Editor.
-- Safe to rerun on the version-1 wallet schema; preserves balances and history.
-- New wallet accounts receive one 10,000-chip welcome grant. No purchases or cash value.
-- Daily allowance is 1,000 chips per rolling 24 hours. Funded gameplay requires the Worker Hyperdrive binding.
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
  facts jsonb,
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

-- Grant this NOLOGIN group only to the dedicated database login configured in Hyperdrive.
-- Never grant it to anon, authenticated, authenticator or a browser-facing role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usual_table_wallet_backend') THEN
    CREATE ROLE usual_table_wallet_backend NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA wallet_private TO usual_table_wallet_backend;
GRANT SELECT, INSERT, UPDATE ON wallet_private.accounts, wallet_private.wallets, wallet_private.sessions TO usual_table_wallet_backend;
GRANT SELECT, INSERT ON wallet_private.operations, wallet_private.ledger, wallet_private.grant_claims, wallet_private.results TO usual_table_wallet_backend;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['accounts','wallets','sessions','operations','ledger','grant_claims','results'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'wallet_private' AND tablename = name AND policyname = 'trusted_wallet_backend') THEN
      EXECUTE format('CREATE POLICY trusted_wallet_backend ON wallet_private.%I TO usual_table_wallet_backend USING (true) WITH CHECK (true)', name);
    END IF;
  END LOOP;
END $$;

-- Statistics are a read-only projection of trusted, deduplicated saved-chip results.
-- Existing results are included automatically; no balances/history are rewritten or backfilled.
CREATE OR REPLACE FUNCTION public.usual_table_account_statistics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  account uuid := wallet_private.social_account_id();
  games jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'gameId', stats.game_id,
    'roundsPlayed', stats.played::text, 'roundsWon', stats.won::text,
    'roundsLost', stats.lost::text, 'roundsEven', stats.even::text,
    'wageredUnits', stats.wagered::text, 'returnedUnits', stats.returned::text,
    'netUnits', (stats.returned - stats.wagered)::text, 'bestRoundNetUnits', stats.best::text
  ) ORDER BY stats.game_id), '[]'::jsonb) INTO games
  FROM (
    SELECT s.game_id, count(*) AS played,
      count(*) FILTER (WHERE r.returned_units > r.wagered_units) AS won,
      count(*) FILTER (WHERE r.returned_units < r.wagered_units) AS lost,
      count(*) FILTER (WHERE r.returned_units = r.wagered_units) AS even,
      sum(r.wagered_units) AS wagered, sum(r.returned_units) AS returned,
      greatest(max(r.returned_units - r.wagered_units), 0) AS best
    FROM wallet_private.results r JOIN wallet_private.sessions s
      ON s.account_id = r.account_id AND s.session_id = r.session_id
    WHERE r.account_id = account AND s.funding = 'account'
    GROUP BY s.game_id
  ) stats;
  RETURN jsonb_build_object('contract', 1, 'accountId', account, 'unitsPerChip', 100,
    'basis', 'saved-rounds', 'games', games);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_account_statistics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usual_table_account_statistics() TO authenticated;
NOTIFY pgrst, 'reload schema';

ALTER TABLE wallet_private.results ADD COLUMN IF NOT EXISTS facts jsonb;

CREATE OR REPLACE FUNCTION public.usual_table_allowance()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE account uuid := wallet_private.social_account_id(); next_at timestamptz; stamp timestamptz := clock_timestamp(); summary jsonb;
BEGIN
  summary := public.usual_table_wallet_summary();
  SELECT next_eligible_at INTO next_at FROM wallet_private.grant_claims
    WHERE account_id = account AND source = 'daily' ORDER BY claimed_at DESC LIMIT 1;
  RETURN jsonb_build_object('contract',1,'accountId',account,'amountUnits',100000,'cooldownMs',86400000,
    'serverNow',floor(extract(epoch FROM stamp)*1000),'nextEligibleAt',floor(extract(epoch FROM next_at)*1000),
    'canClaim',coalesce(summary->>'status','active') = 'active' AND (next_at IS NULL OR next_at <= stamp),'claimed',false,'wallet',summary);
END;
$$;
CREATE OR REPLACE FUNCTION public.usual_table_claim_allowance()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE account uuid := wallet_private.social_account_id(); operation uuid; stamp timestamptz; next_at timestamptz;
  balance bigint; wallet_version bigint; summary jsonb; status text;
BEGIN
  PERFORM public.usual_table_ensure_wallet();
  SELECT a.status,w.available_units,w.version INTO status,balance,wallet_version FROM wallet_private.accounts a
    JOIN wallet_private.wallets w USING(account_id) WHERE a.account_id=account FOR UPDATE OF a,w;
  IF status <> 'active' THEN RAISE EXCEPTION 'Wallet paused' USING ERRCODE='42501'; END IF;
  stamp := clock_timestamp();
  SELECT next_eligible_at INTO next_at FROM wallet_private.grant_claims WHERE account_id=account AND source='daily' ORDER BY claimed_at DESC LIMIT 1;
  IF next_at > stamp THEN RETURN public.usual_table_allowance(); END IF;
  IF balance > 9000000000000-100000 THEN RAISE EXCEPTION 'Balance limit reached'; END IF;
  operation := gen_random_uuid();
  UPDATE wallet_private.wallets SET available_units=balance+100000,version=version+1 WHERE account_id=account;
  INSERT INTO wallet_private.grant_claims(account_id,operation_id,source,amount_units,policy_version,claimed_at,next_eligible_at)
    VALUES(account,operation,'daily',100000,'daily-v1-1000',stamp,stamp+interval '24 hours');
  summary := public.usual_table_wallet_summary();
  INSERT INTO wallet_private.ledger(account_id,operation_id,kind,available_delta,table_delta,available_after,wallet_version,policy_version)
    VALUES(account,operation,'claim_grant',100000,0,balance+100000,wallet_version+1,'daily-v1-1000');
  INSERT INTO wallet_private.operations(account_id,operation_id,request,receipt) VALUES(account,operation,
    jsonb_build_object('contract',1,'accountId',account,'operationId',operation,'kind','claim_grant','source','daily'),
    jsonb_build_object('operationId',operation,'wallet',summary,'session',NULL));
  RETURN public.usual_table_allowance() || jsonb_build_object('claimed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_allowance(),public.usual_table_claim_allowance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_allowance(),public.usual_table_claim_allowance() TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE account uuid := wallet_private.social_account_id(); details jsonb;
BEGIN
  SELECT jsonb_build_object('trackedRounds',count(*)::text,
    'hands',coalesce(sum((facts->>'hands')::bigint),0)::text,
    'wins',coalesce(sum((facts->>'wins')::bigint),0)::text,
    'losses',coalesce(sum((facts->>'losses')::bigint),0)::text,
    'pushes',coalesce(sum((facts->>'pushes')::bigint),0)::text,
    'blackjacks',coalesce(sum((facts->>'blackjacks')::bigint),0)::text,
    'busts',coalesce(sum((facts->>'busts')::bigint),0)::text,
    'doubles',coalesce(sum((facts->>'doubles')::bigint),0)::text,
    'splits',coalesce(sum((facts->>'splits')::bigint),0)::text,
    'insuranceTaken',count(*) FILTER(WHERE (facts->>'insuranceTaken')::boolean)::text,
    'insuranceWon',count(*) FILTER(WHERE (facts->>'insuranceWon')::boolean)::text) INTO details
  FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
    WHERE r.account_id=account AND s.game_id='blackjack' AND r.facts IS NOT NULL;
  RETURN jsonb_build_object('accountId',account,'summary',public.usual_table_account_statistics(),'blackjack',details);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics() TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE TABLE IF NOT EXISTS wallet_private.progression_policy (
  version text PRIMARY KEY, starts_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO wallet_private.progression_policy(version) VALUES('progress-v1') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wallet_private.level_claims (
  account_id uuid PRIMARY KEY REFERENCES wallet_private.accounts(account_id), highest_level integer NOT NULL DEFAULT 1 CHECK(highest_level>=1)
);
CREATE TABLE IF NOT EXISTS wallet_private.achievement_definitions (
  id text PRIMARY KEY, game_id text NOT NULL, name text NOT NULL, description text NOT NULL,
  metric text NOT NULL CHECK(metric IN ('rounds','wins','blackjacks')), target integer NOT NULL CHECK(target>0),
  reward_units bigint NOT NULL CHECK(reward_units BETWEEN 1 AND 9000000000000)
);
INSERT INTO wallet_private.achievement_definitions VALUES
 ('blackjack:first-round','blackjack','First Round','Complete a saved-chip Blackjack round.','rounds',1,10000),
 ('blackjack:first-win','blackjack','First Win','Finish a Blackjack round with a net win.','wins',1,10000),
 ('blackjack:first-blackjack','blackjack','First Blackjack','Be dealt a natural blackjack.','blackjacks',1,25000),
 ('blackjack:25-rounds','blackjack','A Regular at the Table','Complete 25 saved-chip Blackjack rounds.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wallet_private.achievement_claims (
  account_id uuid NOT NULL REFERENCES wallet_private.accounts(account_id), achievement_id text NOT NULL REFERENCES wallet_private.achievement_definitions(id),
  operation_id uuid NOT NULL, claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,achievement_id),
  FOREIGN KEY(account_id,operation_id) REFERENCES wallet_private.operations(account_id,operation_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE wallet_private.ledger DROP CONSTRAINT IF EXISTS ledger_kind_check;
ALTER TABLE wallet_private.ledger ADD CONSTRAINT ledger_kind_check CHECK(kind IN ('claim_grant','claim_reward','allocate','activate','cancel_allocation','settle','request_return','complete_return'));
ALTER TABLE wallet_private.progression_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.level_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_private.achievement_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_private.progression_policy,wallet_private.level_claims,wallet_private.achievement_definitions,wallet_private.achievement_claims FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS immutable_achievement_claims ON wallet_private.achievement_claims;
CREATE TRIGGER immutable_achievement_claims BEFORE UPDATE OR DELETE ON wallet_private.achievement_claims FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
DROP TRIGGER IF EXISTS immutable_progression_policy ON wallet_private.progression_policy;
CREATE TRIGGER immutable_progression_policy BEFORE UPDATE OR DELETE ON wallet_private.progression_policy FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();
DROP TRIGGER IF EXISTS immutable_achievement_definitions ON wallet_private.achievement_definitions;
CREATE TRIGGER immutable_achievement_definitions BEFORE UPDATE OR DELETE ON wallet_private.achievement_definitions FOR EACH ROW EXECUTE FUNCTION wallet_private.reject_history_mutation();

CREATE OR REPLACE FUNCTION public.usual_table_progression()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); start_at timestamptz; experience numeric; current_level integer;
  claimed_level integer; achievements jsonb; rewards numeric;
BEGIN
  SELECT starts_at INTO start_at FROM wallet_private.progression_policy WHERE version='progress-v1';
  SELECT count(*)*10::numeric INTO experience FROM wallet_private.results WHERE account_id=account AND created_at>=start_at;
  current_level:=floor((1+sqrt(1+8*experience/100))/2)::integer;
  SELECT highest_level INTO claimed_level FROM wallet_private.level_claims WHERE account_id=account;
  claimed_level:=coalesce(claimed_level,1);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'gameId',a.game_id,'name',a.name,'description',a.description,
    'rewardUnits',a.reward_units,'target',a.target,'progress',a.progress::text,'unlocked',a.progress>=a.target,'claimed',a.claimed) ORDER BY a.game_id,a.id),'[]'::jsonb),
    coalesce(sum(a.reward_units) FILTER(WHERE a.progress>=a.target AND NOT a.claimed),0) INTO achievements,rewards FROM (
    SELECT d.*,EXISTS(SELECT 1 FROM wallet_private.achievement_claims c WHERE c.account_id=account AND c.achievement_id=d.id) AS claimed,
      (SELECT CASE d.metric WHEN 'rounds' THEN count(*)::numeric WHEN 'wins' THEN count(*) FILTER(WHERE r.returned_units>r.wagered_units)::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=start_at AND s.game_id=d.game_id) AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;
CREATE OR REPLACE FUNCTION public.usual_table_claim_rewards()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); snapshot jsonb; reward bigint; operation uuid; balance bigint; wallet_version bigint; status text; a jsonb;
BEGIN
  PERFORM public.usual_table_ensure_wallet();
  SELECT w.available_units,w.version,ac.status INTO balance,wallet_version,status FROM wallet_private.accounts ac
    JOIN wallet_private.wallets w USING(account_id) WHERE ac.account_id=account FOR UPDATE OF ac,w;
  IF status<>'active' THEN RAISE EXCEPTION 'Wallet paused' USING ERRCODE='42501'; END IF;
  snapshot:=public.usual_table_progression(); reward:=(snapshot->>'readyRewardUnits')::bigint;
  IF reward=0 THEN RETURN snapshot; END IF;
  IF reward>9000000000000-balance THEN RAISE EXCEPTION 'Balance limit reached'; END IF;
  operation:=gen_random_uuid();
  FOR a IN SELECT * FROM jsonb_array_elements(snapshot->'achievements') LOOP
    IF (a->>'unlocked')::boolean AND NOT (a->>'claimed')::boolean THEN
      INSERT INTO wallet_private.achievement_claims(account_id,achievement_id,operation_id) VALUES(account,a->>'id',operation);
    END IF;
  END LOOP;
  INSERT INTO wallet_private.level_claims(account_id,highest_level) VALUES(account,(snapshot->>'level')::integer)
    ON CONFLICT(account_id) DO UPDATE SET highest_level=EXCLUDED.highest_level;
  UPDATE wallet_private.wallets SET available_units=balance+reward,version=version+1 WHERE account_id=account;
  INSERT INTO wallet_private.ledger(account_id,operation_id,kind,available_delta,table_delta,available_after,wallet_version,policy_version)
    VALUES(account,operation,'claim_reward',reward,0,balance+reward,wallet_version+1,'progress-v1');
  INSERT INTO wallet_private.operations(account_id,operation_id,request,receipt) VALUES(account,operation,
    jsonb_build_object('contract',1,'accountId',account,'operationId',operation,'kind','claim_reward','throughLevel',snapshot->'level',
      'achievements',(SELECT coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) FROM jsonb_array_elements(snapshot->'achievements') WHERE (value->>'unlocked')::boolean AND NOT (value->>'claimed')::boolean)),
    jsonb_build_object('operationId',operation,'wallet',public.usual_table_wallet_summary(),'session',NULL));
  RETURN public.usual_table_progression() || jsonb_build_object('claimedUnits',reward);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_progression(),public.usual_table_claim_rewards() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_progression(),public.usual_table_claim_rewards() TO authenticated;
NOTIFY pgrst,'reload schema';

-- Additive Crash achievements. Existing grants, balances, claims and progression start are preserved.
ALTER TABLE wallet_private.achievement_definitions DROP CONSTRAINT IF EXISTS achievement_definitions_metric_check;
ALTER TABLE wallet_private.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK(metric IN ('rounds','wins','blackjacks','cashouts','cashout-5x','tie-wins','straight-wins'));
INSERT INTO wallet_private.achievement_definitions VALUES
 ('crash:first-round','crash','First Round','Complete a saved-chip Crash round.','rounds',1,10000),
 ('crash:first-cashout','crash','First Cash-Out','Cash out a saved-chip Crash wager.','cashouts',1,10000),
 ('crash:five-times','crash','High Flyer','Cash out at 5x or higher.','cashout-5x',1,25000),
 ('crash:25-rounds','crash','Frequent Flyer','Complete 25 saved-chip Crash rounds.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.usual_table_progression()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); start_at timestamptz; experience numeric; current_level integer;
  claimed_level integer; achievements jsonb; rewards numeric;
BEGIN
  SELECT starts_at INTO start_at FROM wallet_private.progression_policy WHERE version='progress-v1';
  SELECT count(*)*10::numeric INTO experience FROM wallet_private.results WHERE account_id=account AND created_at>=start_at;
  current_level:=floor((1+sqrt(1+8*experience/100))/2)::integer;
  SELECT highest_level INTO claimed_level FROM wallet_private.level_claims WHERE account_id=account;
  claimed_level:=coalesce(claimed_level,1);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'gameId',a.game_id,'name',a.name,'description',a.description,
    'rewardUnits',a.reward_units,'target',a.target,'progress',a.progress::text,'unlocked',a.progress>=a.target,'claimed',a.claimed) ORDER BY a.game_id,a.id),'[]'::jsonb),
    coalesce(sum(a.reward_units) FILTER(WHERE a.progress>=a.target AND NOT a.claimed),0) INTO achievements,rewards FROM (
    SELECT d.*,EXISTS(SELECT 1 FROM wallet_private.achievement_claims c WHERE c.account_id=account AND c.achievement_id=d.id) AS claimed,
      (SELECT CASE d.metric WHEN 'rounds' THEN count(*)::numeric WHEN 'wins' THEN count(*) FILTER(WHERE r.returned_units>r.wagered_units)::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric
        WHEN 'cashouts' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::numeric
        WHEN 'cashout-5x' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean AND (r.facts->>'cashoutCents')::integer>=500)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=start_at AND s.game_id=d.game_id) AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;

-- Keep the old detailed RPC shape for deployed older Workers during SQL-first rollout.
CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); details jsonb;
BEGIN
  SELECT jsonb_build_object('trackedRounds',count(*)::text,
    'cashouts',count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::text,
    'crashes',count(*) FILTER(WHERE NOT (r.facts->>'cashedOut')::boolean)::text,
    'highestCashoutCents',coalesce(max((r.facts->>'cashoutCents')::integer),0)::text) INTO details
  FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
    WHERE r.account_id=account AND s.game_id='crash' AND r.facts IS NOT NULL;
  RETURN public.usual_table_detailed_statistics() || jsonb_build_object('crash',details);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics_v2() TO authenticated;
NOTIFY pgrst,'reload schema';

-- No-commission Baccarat: additive achievements and detail RPC; retain existing balances and progression policy.
ALTER TABLE wallet_private.achievement_definitions DROP CONSTRAINT IF EXISTS achievement_definitions_metric_check;
ALTER TABLE wallet_private.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK(metric IN ('rounds','wins','blackjacks','cashouts','cashout-5x','tie-wins','straight-wins'));
INSERT INTO wallet_private.achievement_definitions VALUES
 ('baccarat:first-round','baccarat','First Round','Complete a saved-chip Baccarat round.','rounds',1,10000),
 ('baccarat:first-win','baccarat','First Win','Finish a saved-chip Baccarat round with a profit.','wins',1,10000),
 ('baccarat:tie-win','baccarat','Against the Odds','Win a saved-chip Tie bet.','tie-wins',1,25000),
 ('baccarat:25-rounds','baccarat','Regular at the Table','Complete 25 saved-chip Baccarat rounds.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.usual_table_progression()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); start_at timestamptz; experience numeric; current_level integer;
  claimed_level integer; achievements jsonb; rewards numeric;
BEGIN
  SELECT starts_at INTO start_at FROM wallet_private.progression_policy WHERE version='progress-v1';
  SELECT count(*)*10::numeric INTO experience FROM wallet_private.results WHERE account_id=account AND created_at>=start_at;
  current_level:=floor((1+sqrt(1+8*experience/100))/2)::integer;
  SELECT highest_level INTO claimed_level FROM wallet_private.level_claims WHERE account_id=account;
  claimed_level:=coalesce(claimed_level,1);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'gameId',a.game_id,'name',a.name,'description',a.description,
    'rewardUnits',a.reward_units,'target',a.target,'progress',a.progress::text,'unlocked',a.progress>=a.target,'claimed',a.claimed) ORDER BY a.game_id,a.id),'[]'::jsonb),
    coalesce(sum(a.reward_units) FILTER(WHERE a.progress>=a.target AND NOT a.claimed),0) INTO achievements,rewards FROM (
    SELECT d.*,EXISTS(SELECT 1 FROM wallet_private.achievement_claims c WHERE c.account_id=account AND c.achievement_id=d.id) AS claimed,
      (SELECT CASE d.metric WHEN 'rounds' THEN count(*)::numeric WHEN 'wins' THEN count(*) FILTER(WHERE r.returned_units>r.wagered_units)::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric
        WHEN 'tie-wins' THEN count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0 AND r.facts->>'outcome'='tie')::numeric
        WHEN 'cashouts' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::numeric
        WHEN 'cashout-5x' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean AND (r.facts->>'cashoutCents')::integer>=500)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=start_at AND s.game_id=d.game_id) AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;


CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics_v3()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); details jsonb;
BEGIN
 SELECT jsonb_build_object('trackedRounds',count(*)::text,
 'playerBets',count(*) FILTER(WHERE r.facts->>'mainSide'='player')::text,
 'bankerBets',count(*) FILTER(WHERE r.facts->>'mainSide'='banker')::text,
 'tieBets',count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0)::text,
 'tieWins',count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0 AND r.facts->>'outcome'='tie')::text,
 'bankerSixWins',count(*) FILTER(WHERE r.facts->>'mainSide'='banker' AND r.facts->>'outcome'='banker' AND (r.facts->>'bankerTotal')::integer=6)::text,
 'commissionUnits',coalesce(sum((r.facts->>'commissionUnits')::numeric),0)::numeric(40,0)::text) INTO details
 FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
 WHERE r.account_id=account AND s.game_id='baccarat' AND r.facts IS NOT NULL;
 RETURN public.usual_table_detailed_statistics_v2() || jsonb_build_object('baccarat',details);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics_v3() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics_v3() TO authenticated;
NOTIFY pgrst,'reload schema';

-- Add Duck Race rewards without replacing existing progression, claims or balances.
INSERT INTO wallet_private.achievement_definitions VALUES
 ('duck-race:first-race','duck-race','First Race','Complete a saved-chip Duck Race.','rounds',1,10000),
 ('duck-race:first-win','duck-race','First Win','Win a saved-chip Duck Race.','wins',1,10000),
 ('duck-race:10-wins','duck-race','Lucky Duck','Win 10 saved-chip Duck Races.','wins',10,25000),
 ('duck-race:25-races','duck-race','Regular Racer','Complete 25 saved-chip Duck Races.','rounds',25,25000)
 ON CONFLICT DO NOTHING;

-- Add Roulette without changing prior rewards, claims or the progression cutover.
ALTER TABLE wallet_private.achievement_definitions DROP CONSTRAINT IF EXISTS achievement_definitions_metric_check;
ALTER TABLE wallet_private.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK(metric IN ('rounds','wins','blackjacks','cashouts','cashout-5x','tie-wins','straight-wins'));
INSERT INTO wallet_private.achievement_definitions VALUES
 ('roulette:first-spin','roulette','First Spin','Complete a saved-chip Roulette spin.','rounds',1,10000),
 ('roulette:first-win','roulette','First Profitable Spin','Finish a saved-chip Roulette spin with a profit.','wins',1,10000),
 ('roulette:straight-win','roulette','Right on the Number','Win a saved-chip straight-up bet.','straight-wins',1,25000),
 ('roulette:25-spins','roulette','Regular Spinner','Complete 25 saved-chip Roulette spins.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.usual_table_progression()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); start_at timestamptz; experience numeric; current_level integer;
  claimed_level integer; achievements jsonb; rewards numeric;
BEGIN
  SELECT starts_at INTO start_at FROM wallet_private.progression_policy WHERE version='progress-v1';
  SELECT count(*)*10::numeric INTO experience FROM wallet_private.results WHERE account_id=account AND created_at>=start_at;
  current_level:=floor((1+sqrt(1+8*experience/100))/2)::integer;
  SELECT highest_level INTO claimed_level FROM wallet_private.level_claims WHERE account_id=account;
  claimed_level:=coalesce(claimed_level,1);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'gameId',a.game_id,'name',a.name,'description',a.description,
    'rewardUnits',a.reward_units,'target',a.target,'progress',a.progress::text,'unlocked',a.progress>=a.target,'claimed',a.claimed) ORDER BY a.game_id,a.id),'[]'::jsonb),
    coalesce(sum(a.reward_units) FILTER(WHERE a.progress>=a.target AND NOT a.claimed),0) INTO achievements,rewards FROM (
    SELECT d.*,EXISTS(SELECT 1 FROM wallet_private.achievement_claims c WHERE c.account_id=account AND c.achievement_id=d.id) AS claimed,
      (SELECT CASE d.metric WHEN 'rounds' THEN count(*)::numeric WHEN 'wins' THEN count(*) FILTER(WHERE r.returned_units>r.wagered_units)::numeric
        WHEN 'straight-wins' THEN count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.facts->'bets','[]'::jsonb)) b WHERE b->>'betId'='straight-' || (r.facts->>'winner')))::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric
        WHEN 'tie-wins' THEN count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0 AND r.facts->>'outcome'='tie')::numeric
        WHEN 'cashouts' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::numeric
        WHEN 'cashout-5x' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean AND (r.facts->>'cashoutCents')::integer>=500)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=start_at AND s.game_id=d.game_id) AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;



CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics_v4()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); details jsonb;
BEGIN
 SELECT jsonb_build_object('trackedRounds',count(*)::text,'straightUpWins',count(*) FILTER(WHERE EXISTS(
 SELECT 1 FROM jsonb_array_elements(coalesce(r.facts->'bets','[]'::jsonb)) b WHERE b->>'betId'='straight-' || (r.facts->>'winner')))::text) INTO details
 FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
 WHERE r.account_id=account AND s.game_id='roulette' AND r.facts IS NOT NULL;
 RETURN public.usual_table_detailed_statistics_v3() || jsonb_build_object('roulette',details);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics_v4() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics_v4() TO authenticated;
NOTIFY pgrst,'reload schema';

-- Side-bet stakes/returns are included in the existing authoritative round totals.
-- Keep previous RPCs intact for older clients; no backfill or progression reset.
CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics_v5()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); summary jsonb; pairs jsonb;
BEGIN
  summary:=public.usual_table_detailed_statistics_v4();
  SELECT jsonb_build_object(
    'perfectPairsBets',count(*) FILTER(WHERE (r.facts->'perfectPairs'->>'wagerUnits')::bigint>0)::text,
    'perfectPairsWins',count(*) FILTER(WHERE (r.facts->'perfectPairs'->>'returnedUnits')::bigint>0)::text,
    'perfectPairsWageredUnits',coalesce(sum((r.facts->'perfectPairs'->>'wagerUnits')::numeric),0)::text,
    'perfectPairsReturnedUnits',coalesce(sum((r.facts->'perfectPairs'->>'returnedUnits')::numeric),0)::text
  ) INTO pairs FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
    WHERE r.account_id=account AND s.game_id='blackjack';
  RETURN jsonb_set(summary,'{blackjack}',(summary->'blackjack')||pairs);
END;
$$;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics_v5() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics_v5() TO authenticated;
NOTIFY pgrst,'reload schema';

-- Account-owned display settings; names deliberately have no uniqueness constraint.
CREATE TABLE IF NOT EXISTS wallet_private.player_profiles (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text CHECK(nickname IS NULL OR length(btrim(nickname)) BETWEEN 1 AND 24),
  appearance jsonb NOT NULL DEFAULT '{"avatar":{"kind":"initials"},"border":"none"}',
  visibility jsonb NOT NULL DEFAULT '{"chips":true,"statistics":true,"achievements":true}',
  version bigint NOT NULL DEFAULT 0 CHECK(version>=0)
);
ALTER TABLE wallet_private.player_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_private.player_profiles FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION wallet_private.valid_profile_appearance(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-ARRAY['avatar','border']='{}'::jsonb
 AND value->>'border' IN ('none','sage','brass','midnight','copper','royal','orbit')
 AND jsonb_typeof(value->'avatar')='object' AND CASE value->'avatar'->>'kind'
 WHEN 'initials' THEN value->'avatar'='{"kind":"initials"}'::jsonb
 WHEN 'illustration' THEN (value->'avatar')-ARRAY['kind','id']='{}'::jsonb AND value->'avatar'->>'id' IN ('fox','owl','panda','robot','cat','penguin','moon','club')
 WHEN 'emoji' THEN (value->'avatar')-ARRAY['kind','id']='{}'::jsonb AND value->'avatar'->>'id' IN ('😎','🦊','🐱','🐶','🐼','🐸','🦁','🦉','🦄','🐙','🤖','👽','🎩','🍀','🔥','⭐')
 ELSE false END,false)
$$;
CREATE OR REPLACE FUNCTION public.usual_table_profile()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); metadata jsonb; p wallet_private.player_profiles;
BEGIN
  SELECT to_jsonb(u)->'raw_user_meta_data' INTO metadata FROM auth.users u WHERE id=account;
  INSERT INTO wallet_private.player_profiles(account_id,nickname,appearance)
  VALUES(account,CASE WHEN length(btrim(metadata->>'usual_table_nickname')) BETWEEN 1 AND 24 THEN btrim(metadata->>'usual_table_nickname') END,
    CASE WHEN wallet_private.valid_profile_appearance(jsonb_build_object('avatar',jsonb_build_object('kind','emoji','id',metadata->>'usual_table_player_icon'),'border','none'))
    THEN jsonb_build_object('avatar',jsonb_build_object('kind','emoji','id',metadata->>'usual_table_player_icon'),'border','none') ELSE '{"avatar":{"kind":"initials"},"border":"none"}' END)
  ON CONFLICT DO NOTHING;
  SELECT * INTO p FROM wallet_private.player_profiles WHERE account_id=account;
  RETURN jsonb_build_object('contract',1,'accountId',account,'version',p.version,'nickname',p.nickname,'appearance',p.appearance,'visibility',p.visibility);
END; $$;
CREATE OR REPLACE FUNCTION public.usual_table_save_profile(input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id(); p wallet_private.player_profiles;
BEGIN
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['nickname','appearance','visibility','version']<>'{}'::jsonb
    OR jsonb_typeof(input->'nickname') IS DISTINCT FROM 'string' OR length(btrim(input->>'nickname')) NOT BETWEEN 1 AND 24
    OR NOT wallet_private.valid_profile_appearance(input->'appearance')
    OR jsonb_typeof(input->'visibility') IS DISTINCT FROM 'object' OR (input->'visibility')-ARRAY['chips','statistics','achievements']<>'{}'::jsonb
    OR jsonb_typeof(input->'visibility'->'chips') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'visibility'->'statistics') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(input->'visibility'->'achievements') IS DISTINCT FROM 'boolean' OR coalesce(input->>'version','') !~ '^(0|[1-9][0-9]{0,14})$'
    THEN RAISE EXCEPTION 'Invalid profile selection' USING ERRCODE='22023'; END IF;
  PERFORM public.usual_table_profile();
  UPDATE wallet_private.player_profiles SET nickname=btrim(input->>'nickname'),appearance=input->'appearance',visibility=input->'visibility',version=version+1
    WHERE account_id=account AND version=(input->>'version')::bigint RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile changed; reload before saving' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('contract',1,'accountId',account,'version',p.version,'nickname',p.nickname,'appearance',p.appearance,'visibility',p.visibility);
END; $$;
-- Only the trusted Worker database role can select a target. Browser RPCs cannot call this function.
-- Reuse authoritative game projections in one snapshot, restoring transaction-local claims before return.
CREATE OR REPLACE FUNCTION wallet_private.room_player_profile(target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_claims text:=current_setting('request.jwt.claims',true); previous_sub text:=current_setting('request.jwt.claim.sub',true); previous_role text:=current_setting('request.jwt.claim.role',true);
  settings jsonb; progress jsonb; details jsonb; wallet jsonb; result jsonb; earned jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','oauth')))::text,true);
  PERFORM set_config('request.jwt.claim.sub',target::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  settings:=public.usual_table_profile();
  progress:=public.usual_table_progression();
  result:=jsonb_build_object('kind','account','appearance',settings->'appearance','version',settings->'version','visibility',settings->'visibility','level',progress->'level');
  IF (settings->'visibility'->>'chips')::boolean THEN
    wallet:=public.usual_table_wallet_summary();
    result:=result||jsonb_build_object('totalSavedChipUnits',CASE WHEN wallet IS NULL THEN NULL ELSE
      ((wallet->>'availableUnits')::numeric+(wallet->>'atTablesUnits')::numeric+(wallet->>'pendingReturnUnits')::numeric)::text END);
  END IF;
  IF (settings->'visibility'->>'statistics')::boolean THEN
    details:=public.usual_table_detailed_statistics_v5();
    result:=result||jsonb_build_object('statistics',(details-ARRAY['accountId','summary'])||jsonb_build_object('games',details->'summary'->'games'));
  END IF;
  IF (settings->'visibility'->>'achievements')::boolean THEN
    SELECT coalesce(jsonb_agg(a-'claimed'),'[]'::jsonb) INTO earned FROM jsonb_array_elements(progress->'achievements') a;
    result:=result||jsonb_build_object('achievements',earned);
  END IF;
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true); RAISE;
END; $$;
REVOKE ALL ON FUNCTION wallet_private.valid_profile_appearance(jsonb),wallet_private.room_player_profile(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.usual_table_profile(),public.usual_table_save_profile(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_profile(),public.usual_table_save_profile(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_private.room_player_profile(uuid) TO usual_table_wallet_backend;
NOTIFY pgrst,'reload schema';
COMMIT;
