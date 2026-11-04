# Crash

Approved rules and local implementation, 4 November 2026 (Australia/Brisbane). All chips are virtual; there are no purchases or real-money redemption.

Crash is the second game using the [shared table adapters](GAME_ADAPTERS.md). It uses the same catalog, public/private lobby browser, profile/guest entry, invitations, controller ownership, reconnect, chat, saved-wallet allocation and safe Leave flow as Blackjack.

## Approved rules

| Setting | Rule |
| --- | --- |
| Table | 1–8 players; public or private; guests and saved-account seats can share a flight |
| Temporary stack | 1,000 chips; no saved history, statistics, XP or achievements |
| Saved buy-in | Defaults to 1,000 chips; minimum 10 chips in steps of 10; funds come from the existing account wallet |
| Wager | One locked wager per player per round; 10–1,000 chips in steps of 10; no automatic repeat bets |
| Betting window | 10 seconds; the host starts rounds once, with automatic subsequent windows |
| Empty window | Pauses the game; the host can resume it |
| Multiplier | Starts at 1.00×; approximately 2× after 7 seconds and 10× after 23 seconds |
| Cash-out | Manual, or an optional target fixed with the wager, from 1.01× to 100× in 0.01 steps |
| Payout | Includes the original wager: 100 chips at 2× returns 200 chips |
| Crash | Server-owned random outcome with a 3% house edge; immediate crashes at 1.00× are possible |
| Ceiling | Surviving flights stop at 100× and pay remaining wagers automatically; a natural crash exactly at 100× still wins ties |
| Ordering | Server processing and time decide acceptance; at the crash boundary, crash wins ties |
| Results | Five seconds, followed by the next betting window; no host override or auto-bet feature |
| Disconnect | An existing auto target continues to work. A manual wager remains live and can be cashed out after reconnect only if it has not crashed |
| Leave | A locked wager stays committed through settlement. Remaining saved chips return through the shared durable wallet outbox |

Other players' wagers and cash-outs are visible. Late joiners can watch the current flight and wager in the next betting window. The desktop screen has persistent side chat; smaller screens use the shared chat dialog. Eight-player controls and player status remain on screen in desktop, phone and short-landscape acceptance. Reduced motion hides the moving curve while keeping authoritative figures and actions.

**Last 10 results** shows this lobby's completed crash multipliers, newest first, including ceiling flights. All ten values remain visible in a compact two-row grid on smaller screens. History survives reloads and is shared with late joiners; a new lobby starts empty, and unfinished flights are never added early. This display uses the existing stored history and needs only a frontend redeploy, with no additional SQL or Worker change.

## Engine and ordering

[`packages/crash`](packages/crash/src/index.ts) contains a pure engine with injected time and randomness. Chips use integer hundredths; multipliers use integer hundredths too (`200` means 2.00×). Wagers are whole multiples of 10 chips, so cent-multiplier payouts are exact in canonical wallet units. The browser never supplies a payout or claimed cash-out multiplier.

The multiplier is `floor(100 * exp(elapsedMs / 10000))`, bounded at 10,000 hundredths. A target's deadline is the first integer millisecond at which the growth curve reaches it. Cash-outs are accepted only before the private crash deadline. An auto target strictly below the crash point is honored even when the alarm runs late. Targets equal to the crash point lose, with the separately recorded ceiling exception above.

The server uses unbiased cryptographic integer sampling over one billion values. For a sample `r` in `[0, N)`, `N = 1,000,000,000`, the raw crash point in multiplier hundredths is `ceil(97 * N / (N-r))`. Values below 100 become an immediate 1.00× crash; raw values above 10,000 become a surviving ceiling flight. This gives survival probability approximately `0.97 / multiplier` for a fixed cash-out target, subject to the finite integer sampling grid. Sampling and fixed-target expected returns are covered by deterministic distribution checks.

[`games/crash.ts`](apps/server/src/games/crash.ts) owns server actions, legal moves, snapshots, membership cleanup, alarms and strict restoration. A complete running snapshot contains the flight start time, never the private crash point or crash deadline. Outcomes become public only during results. Commands carry the round ID; another player's revision change does not invalidate a timely action on your own wager. Accepted command IDs are deduplicated. A second fresh cash-out on an already cashed wager is rejected.

Advancement records one phase at a time so an overdue alarm cannot erase a completed round before its wallet result is queued. Reservations, committed wagers and pending chip returns survive reload/eviction. Unknown/corrupt state fails closed; it is never replaced with a fresh bankroll.

## Saved chips, statistics and rewards

[`crashWallet.ts`](apps/server/src/games/crashWallet.ts) connects Crash to the shared wallet courier. It discards the temporary starting stack before allocating saved funds, activates only acknowledged funding, checks engine/stack reconciliation and queues one result per participating account per round. Results and queue changes are saved together before delivery. Lost acknowledgements retry the same operation; Leave cannot cancel a wager, repeat a payout or turn guest chips into account funds. Saved seats never receive guest refills.

Canonical settlement facts record successful cash-out, accepted cash-out multiplier, crash multiplier and ceiling status. The wallet validates these against the returned amount and game identity. General statistics cover rounds won/lost/even, wagered, returned, net chips and best round. Crash details add successful cash-outs, wagers lost to crashes and highest accepted cash-out multiplier.

Each completed saved-chip round with a wager earns the existing **10 XP**, regardless of amount or result. It shares the existing account level thresholds and once-only 1,000-chip level reward. Idle watchers and temporary players earn none.

| Achievement | Requirement | Reward |
| --- | --- | --- |
| First Round | Complete one saved-chip Crash round | 100 chips |
| First Cash-Out | Cash out one saved-chip Crash wager | 100 chips |
| High Flyer | Cash out at 5× or higher | 250 chips |
| Frequent Flyer | Complete 25 saved-chip Crash rounds | 250 chips |

Rewards are claimable through the existing profile Progress & achievements view. Each achievement is claimed once per account, independently of daily allowance and level rewards. Account UUIDs remain the identity key; display names may clash.

## Activate on the live site

1. Apply [migration 009](packages/wallet/migrations/009_crash.sql) after migrations 001–008, or rerun the complete current [Supabase wallet installer](supabase/wallet-setup.sql) in the SQL Editor. This preserves balances, history, cooldowns, claims and the existing progression start date. It adds Crash achievement metrics/definitions and the `usual_table_detailed_statistics_v2` RPC. The original detailed-statistics RPC retains its shape for older Workers during SQL-first rollout.
2. Deploy **Cloudflare Worker**. Crash uses the existing room/directory bindings and Hyperdrive backend; there is no new secret, namespace or Durable Object migration tag. The existing Blackjack adapter and storage are unchanged.
3. Deploy **GitHub Pages**. Its health gate requires `crashProtocol: 1` so the frontend cannot precede the compatible Worker.
4. Verify a live signed-in private flight: record available balance and buy-in, wager and actual payout, remaining stack, then Leave and refresh. Confirm the returned wallet balance, one saved round/10 XP, the correct Crash detail counters and once-only eligible rewards. Test a guest joining the same table without generating saved data, plus an auto target during reconnect.

The SQL, deployments and authenticated live Crash checks have not been performed by the agent. Browser account/provider responses are simulated; engine, native PostgreSQL/concurrency and Cloudflare runtime checks cover the server and financial paths separately. Physical devices/Safari and the wider accessibility audit remain deferred as previously requested.

## Implementation entry points

- [Public DTOs/actions](packages/protocol/src/crash.ts), [trusted result facts](packages/protocol/src/crashStatistics.ts)
- [Engine](packages/crash/src/index.ts), [server adapter and restoration](apps/server/src/games/crash.ts), [wallet integration](apps/server/src/games/crashWallet.ts)
- [Game UI](apps/web/src/CrashTable.tsx), [layout](apps/web/src/CrashTable.module.css)
- [Pure rules tests](packages/crash/src/crash.test.ts), [Cloudflare lifecycle tests](apps/server/tests/crash.test.ts), [wallet/reward tests](packages/wallet/src/crash.test.ts), [native database concurrency](packages/wallet/src/postgres.test.ts), [browser acceptance](tests/e2e/crash.spec.ts)

Browser fixtures are isolated test code. The deployed app has no outcome seed, clock control or fixture endpoint.
