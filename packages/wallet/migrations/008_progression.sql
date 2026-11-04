BEGIN;
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
COMMIT;
