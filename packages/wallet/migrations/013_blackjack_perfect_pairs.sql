BEGIN;
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
COMMIT;
