BEGIN;
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
COMMIT;
