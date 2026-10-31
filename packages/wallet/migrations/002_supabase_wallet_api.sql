BEGIN;
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
COMMIT;
