BEGIN;
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
COMMIT;
