/* global URL */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('includes the exact versioned wallet migrations in the reviewable Supabase installer', () => {
  const setup = readFileSync(new URL('../supabase/wallet-setup.sql', import.meta.url), 'utf8');
  for (const name of ['001_wallet.sql', '002_supabase_wallet_api.sql', '003_welcome_grant.sql', '004_backend_role.sql']) {
    const migration = readFileSync(new URL(`../packages/wallet/migrations/${name}`, import.meta.url), 'utf8').replace(/^BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '').trim();
    expect(setup).toContain(migration);
  }
});
