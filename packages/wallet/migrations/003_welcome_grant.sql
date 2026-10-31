BEGIN;
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
