/* global URL */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function body(name) {
  return readFileSync(new URL(`../packages/wallet/migrations/${name}`, import.meta.url), 'utf8')
    .replace(/^BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '').trim();
}
const schema = body('001_wallet.sql');
const migrations = ['002_supabase_wallet_api.sql', '003_welcome_grant.sql', '004_backend_role.sql', '005_account_statistics.sql', '006_daily_allowance.sql', '007_detailed_statistics.sql', '008_progression.sql','009_crash.sql','010_baccarat.sql','011_duck_race.sql','012_roulette.sql','013_blackjack_perfect_pairs.sql','014_player_profiles.sql','015_cosmetic_collections.sql'].map(body).join('\n\n');
// Reinstalling earlier increments must not temporarily reject achievement definitions added by later games.
const metricConstraint=/ALTER TABLE wallet_private\.achievement_definitions ADD CONSTRAINT achievement_definitions_metric_check CHECK\([^;]+;/g;
const latestMetricConstraint=[...migrations.matchAll(metricConstraint)].at(-1)?.[0];
if(!latestMetricConstraint)throw new Error('Missing final achievement metric constraint');
const api=migrations.replace(metricConstraint,latestMetricConstraint);
const sql = `-- The Usual Table: run this complete file in Supabase SQL Editor.
-- Safe to rerun on the version-1 wallet schema; preserves balances and history.
-- New wallet accounts receive one 10,000-chip welcome grant. No purchases or cash value.
-- Daily allowance is 1,000 chips per rolling 24 hours. Funded gameplay requires the Worker Hyperdrive binding.
BEGIN;
DO $install$
BEGIN
  IF to_regnamespace('wallet_private') IS NULL THEN
    EXECUTE $wallet_schema$
${schema}
$wallet_schema$;
  ELSE
    IF to_regclass('wallet_private.schema_version') IS NULL THEN
      RAISE EXCEPTION 'An unrecognized wallet_private schema exists; inspect it before continuing';
    END IF;
    IF (SELECT count(*) FROM wallet_private.schema_version WHERE version = 1) <> 1
      OR (SELECT count(*) FROM wallet_private.schema_version) <> 1 THEN
      RAISE EXCEPTION 'Unsupported wallet schema version';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['accounts','wallets','sessions','operations','ledger','grant_claims','results']) name
      WHERE to_regclass('wallet_private.' || name) IS NULL) THEN
      RAISE EXCEPTION 'Wallet storage is incomplete; restore it rather than resetting balances';
    END IF;
  END IF;
END;
$install$;

${api}
COMMIT;
`;
mkdirSync(new URL('../supabase/', import.meta.url), { recursive: true });
writeFileSync(new URL('../supabase/wallet-setup.sql', import.meta.url), sql);
