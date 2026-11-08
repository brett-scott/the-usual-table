BEGIN;
INSERT INTO wallet_private.progression_policy(version) VALUES('keno-v1') ON CONFLICT DO NOTHING;
ALTER TABLE wallet_private.achievement_definitions DROP CONSTRAINT IF EXISTS achievement_definitions_metric_check;
ALTER TABLE wallet_private.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK(metric IN ('rounds','wins','blackjacks','cashouts','cashout-5x','tie-wins','straight-wins','keno-five'));
INSERT INTO wallet_private.achievement_definitions VALUES
 ('keno:first-draw','keno','First Draw','Complete a saved-chip Keno draw.','rounds',1,10000),
 ('keno:first-win','keno','First Profitable Draw','Finish a saved-chip Keno draw with a profit.','wins',1,10000),
 ('keno:five-matches','keno','Five Alive','Match five or more numbers on a saved-chip ticket.','keno-five',1,25000),
 ('keno:25-draws','keno','Regular Picker','Complete 25 saved-chip Keno draws.','rounds',25,25000)
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION wallet_private.keno_matches(picks jsonb,drawn jsonb)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT count(*) FROM jsonb_array_elements(coalesce(picks,'[]'::jsonb)) n WHERE coalesce(drawn,'[]'::jsonb) @> jsonb_build_array(n.value)
$$;
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
        WHEN 'keno-five' THEN count(*) FILTER(WHERE wallet_private.keno_matches(r.facts->'numbers',r.facts->'draw')>=5)::numeric
        WHEN 'straight-wins' THEN count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.facts->'bets','[]'::jsonb)) b WHERE b->>'betId'='straight-' || (r.facts->>'winner')))::numeric
        WHEN 'blackjacks' THEN coalesce(sum((r.facts->>'blackjacks')::integer),0)::numeric
        WHEN 'tie-wins' THEN count(*) FILTER(WHERE (r.facts->>'tieUnits')::bigint>0 AND r.facts->>'outcome'='tie')::numeric
        WHEN 'cashouts' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean)::numeric
        WHEN 'cashout-5x' THEN count(*) FILTER(WHERE (r.facts->>'cashedOut')::boolean AND (r.facts->>'cashoutCents')::integer>=500)::numeric END
       FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
       WHERE r.account_id=account AND r.created_at>=greatest(start_at,CASE WHEN d.game_id='keno' THEN (SELECT starts_at FROM wallet_private.progression_policy WHERE version='keno-v1') ELSE start_at END) AND s.game_id=d.game_id) AS progress
    FROM wallet_private.achievement_definitions d
  ) a;
  RETURN jsonb_build_object('contract',1,'accountId',account,'policy','progress-v1','startsAt',floor(extract(epoch FROM start_at)*1000),
    'xpPerRound',10,'xp',experience::text,'level',current_level,'levelStartXp',(100::numeric*(current_level-1)*current_level/2)::numeric(40,0)::text,
    'nextLevelXp',(100::numeric*current_level*(current_level+1)/2)::numeric(40,0)::text,'levelRewardUnits',100000,'claimedLevel',claimed_level,
    'readyRewardUnits',(rewards+greatest(0,current_level-claimed_level)*100000::numeric)::text,'claimedUnits',0,'achievements',achievements,'wallet',public.usual_table_wallet_summary());
END;
$$;
CREATE OR REPLACE FUNCTION wallet_private.keno_statistics(target uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('trackedRounds',count(*)::text,
  'totalMatches',coalesce(sum(wallet_private.keno_matches(r.facts->'numbers',r.facts->'draw')),0)::text,
  'totalPicks',coalesce(sum(jsonb_array_length(r.facts->'numbers')),0)::text,
  'bestMatches',coalesce(max(wallet_private.keno_matches(r.facts->'numbers',r.facts->'draw')),0)::text,
  'bestMultiplierCents',coalesce(max(r.returned_units*100/r.wagered_units),0)::text)
 FROM wallet_private.results r JOIN wallet_private.sessions s USING(account_id,session_id)
 WHERE r.account_id=target AND s.game_id='keno' AND r.facts IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.usual_table_detailed_statistics_v6()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE account uuid:=wallet_private.social_account_id();
BEGIN
 RETURN public.usual_table_detailed_statistics_v5() || jsonb_build_object('keno',wallet_private.keno_statistics(account));
END; $$;
CREATE OR REPLACE FUNCTION wallet_private.room_player_profile_v3(target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb:=wallet_private.room_player_profile_v2(target);
BEGIN
 IF (result->'visibility'->>'statistics')::boolean THEN result:=jsonb_set(result,'{statistics,keno}',wallet_private.keno_statistics(target));END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION wallet_private.keno_matches(jsonb,jsonb),wallet_private.keno_statistics(uuid),wallet_private.room_player_profile_v3(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.usual_table_detailed_statistics_v6() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.usual_table_detailed_statistics_v6() TO authenticated;
GRANT EXECUTE ON FUNCTION wallet_private.room_player_profile_v3(uuid) TO usual_table_wallet_backend;
NOTIFY pgrst,'reload schema';
COMMIT;
