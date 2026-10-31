# Enable saved chips in Blackjack

The saved-chip gameplay code is implemented locally. Live play needs the updated Supabase SQL and a private Cloudflare Hyperdrive connection to the **same Supabase database** used by Auth and the wallet menu. These hosted setup steps have not been performed by this change.

## 1. Apply the wallet installer

Run the entire current [supabase/wallet-setup.sql](supabase/wallet-setup.sql) in Supabase SQL Editor. It safely preserves recognized existing wallets and includes migration 004, which creates a restricted `usual_table_wallet_backend` NOLOGIN group. The existing 10,000-chip welcome grant remains once per newly created wallet; existing accounts are never reset or topped up.

The private backend role can read wallet records, insert immutable history and update account/wallet/session records. RLS policies permit this role. Browser roles retain no access to the private schema and cannot submit wallet commands or payouts.

## 2. Create a dedicated database login

In Supabase SQL Editor, run this **once**, replacing the password with a unique generated value:

```sql
CREATE ROLE usual_table_wallet_login LOGIN INHERIT
  PASSWORD 'REPLACE_WITH_A_UNIQUE_GENERATED_PASSWORD';
GRANT usual_table_wallet_backend TO usual_table_wallet_login;
```

Keep the password in your password manager and Hyperdrive configuration. Do not add it to frontend configuration, repository variables, checked-in files or chat. Do not grant the backend group to `anon`, `authenticated` or `authenticator`.

## 3. Configure Hyperdrive

In the Cloudflare dashboard, open **Hyperdrive**, create a configuration and enter:

- Host: the project's **direct** database host from Supabase's Connect dialog, normally `db.npqvazffslqmfjtyyhpn.supabase.co`.
- Port: `5432`; database: `postgres`.
- Username: `usual_table_wallet_login`; password: the generated password above.
- Use TLS and **disable query caching** for this wallet connection.

Use the direct connection instead of Supabase's session/transaction pooler; Hyperdrive supplies connection pooling. The Worker uses the existing `pg` driver and transaction adapter, with `nodejs_compat` enabled. [Cloudflare Supabase connection guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [Cloudflare PostgreSQL driver guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/).

Copy the resulting Hyperdrive ID. In GitHub **Settings → Environments → production → Environment variables**, add:

```text
CLOUDFLARE_WALLET_HYPERDRIVE_ID=<your 32-character Hyperdrive ID>
```

The deploy workflow generates the `WALLET_DB` binding. The ID is configuration; the database password stays in Hyperdrive. No Supabase service-role key is required.

## 4. Deploy and verify

Deploy the **Worker first**, then **GitHub Pages**. The Pages gate rejects older Workers that lack the saved-chip gameplay protocol. Worker health exposes `accountPlayProtocol: 1` and `accountPlayConfigured: true` when the binding is present; this reports configuration, not a successful database transaction.

1. Sign in, choose **Find a Table → Create a table** and leave **Saved account chips** selected.
2. A new wallet receives 10,000 virtual chips once. With a 1,000-chip buy-in, confirm 9,000 remain available and 1,000 are at the table.
3. Play a round. Check the table stack reflects the result and the wallet menu reports it under At tables.
4. Reload or open the invitation on another device signed in to the same account. It restores the existing seat without another buy-in. The newest controller replaces the previous one.
5. Leave the table. The remaining stack returns once; leaving during a committed hand waits for that hand to finish. When the backend is unavailable, Returning/outstanding room work persists and retries rather than inventing a refund.
6. Verify a different account cannot control the seat. Sign-out stops account controls; signing in again restores the seat while its reservation remains valid.
7. Verify signed-out guests, or signed-in players explicitly choosing **Temporary chips**, still play without using a saved balance. Temporary chips and history never enter the wallet.

Saved play uses periodic authenticated connection renewal. JWT signatures, current social Auth-user existence, wallet status, account ownership and controller claims are checked. Invalid/expired account access pauses controls; committed rounds and financial recovery continue on the server. A disconnect keeps the normal 60-second reservation before the seat is retired and its funds returned after any committed hand.

Buy-ins require at least 10 chips and half-chip precision. The server checks affordability under the account row lock. Account-bound rooms use storage schema 4; older servers must not be deployed over them. New create/join requests carry a canonical entry UUID for retry protection, and repeated creation rejects changed buy-in/visibility settings; stored room decisions and wallet operation IDs prevent repeated allocation or settlement effects. Account seats never offer or accept guest refills.

## Troubleshooting and local development

- **Saved-chip gameplay needs its database connection**: configure the Hyperdrive ID and redeploy the Worker. Temporary play remains available through an explicit choice.
- **Moving your buy-in / Saving your chips**: the durable room outbox is awaiting a database acknowledgement. Check Hyperdrive credentials, migration 004, role membership and database connectivity. Keep pending financial room state intact.
- **Buy-in declined**: check available funds, wallet status and other tables. Leave the rejected seat and choose an affordable buy-in. No guest bankroll is substituted.
- A public publishable key can read/provision the caller's wallet but cannot install migrations or authorize room settlement. Keep the private connection in Hyperdrive.

Normal `npm run dev` supports temporary tables without cloud credentials. To test saved play locally, use a separate ignored Wrangler configuration containing a `WALLET_DB` Hyperdrive binding and a test database `localConnectionString`, plus matching test Auth configuration. Do not point automated tests at the production database. The checked-in suites use isolated PostgreSQL, signed JWT fixtures and browser provider/transport fixtures; hosted Hyperdrive, real-provider and backup/recovery acceptance remain live deployment checks.
