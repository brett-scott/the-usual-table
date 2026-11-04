BEGIN;
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
COMMIT;
