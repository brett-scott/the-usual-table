BEGIN;
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
COMMIT;
