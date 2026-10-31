BEGIN;
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
COMMIT;
