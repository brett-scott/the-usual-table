# Release evidence and remaining checks

Milestone 5 prepares a reproducible release. It does not mean a site or Worker has been deployed. The remaining Milestone 4 work is now **Milestone 6**, per the user's instruction on 28 October 2026.

## Local acceptance evidence

| Area | Automated coverage |
| --- | --- |
| Shoe and rules | Physical six-deck instances, unbiased shuffle seam, sequential/cross-round draws, multi-ace totals, cut/reserve, dealer stand/peek, insurance, naturals and split ancestry |
| Accounting | Half-chip integers, win/loss/push/3:2 payouts, split/double/insurance debit, insufficient funds, bounded retry receipts and no duplicate settlement |
| Shared rooms | Four independent guests, fifth rejected, duplicate names, host transfer, wager locks, wrong-seat/out-of-turn/stale/concurrent commands, hidden-card/private-shoe projection |
| Lifecycle | Reload/offline recovery, missed acknowledgements/snapshots, controller replacement, reservations, silent loss, deadlines/Hit reset, hibernation, persisted alarms, schema migration and invalid-state preservation |
| UI | Repeated playable rounds, split/double/hit/insurance, sequential card reveal, current table themes, keyboard basics, reduced motion, one-screen phone portrait/landscape, long hands and simulated safe areas |
| Deployment configuration | Explicit Pages base/API, rejection of localhost/HTTP/credential-bearing API URLs, separate production Worker identity/limiter, preserved SQLite migration, narrow HTTPS origin list |
| Built subpath | Production assets, welcome/practice, actual multiplayer invitation hashes, refresh/resume and recovery under `/casual-check/` using local Worker |
| HTTP rejection | Bounded streamed request bodies are consumed before forwarding; expired invitations and oversized bodies keep their expected JSON errors without an outstanding forwarded request stream |
| Table chat | Authenticated room-only messages, server-assigned author/seat/time, duplicate suppression, rate and history bounds, hibernation/reload recovery, safe text rendering, offline drafts, unread counts, mobile fit and unchanged game state/timers |
| Personal visuals | Independent saved classic/large-index faces and traditional/geometric backs, stable card identity and game state during changes, private per-browser appearance, exact chip denominations and reduced-motion chip behavior |
| Player icons | Optional emoji selection/default initials, saved entry preference, four-player visibility on mobile and desktop, reload/room eviction persistence and rejection of invalid icon requests |
| Chat presentation | Persistent wide-desktop side panel, compact dialog on phones, bounded 80-character/three-line previews for five seconds, complete 300-character chat history and no history replay as bubbles |
| Betting and results | Max Bet, two-card 9/10/11 double boundaries, numeric bust totals, distinct ready/waiting seats, half-second dealer pauses, shared results deadlines, host skipping, replay-safe alarms and legacy deadline restoration |

Latest local verification includes 92 engine/presentation/transport/release tests and 51 Cloudflare runtime/storage tests (143 total). All 81 browser checks pass against the production bundle at `/casual-check/` with four workers, matching CI's parallelism. They cover optional saved emoji icons and four-player visibility/reload, personal card appearance, desktop side chat, bubble expiry/history suppression, chip placement/double/win/loss and reduced motion, alongside existing gameplay and mobile-fit coverage. The earlier chat regression also passed 20 repeated runs across all four viewport profiles. Unread arrivals are recorded by the transport so UI batching cannot erase them; initial history, repeated frames and self-messages do not inflate the count, and hidden-panel scroll events cannot mark messages read. The browser test waits for the receiver's initial chat handshake before sending. Lint, TypeScript and frontend/Worker build validation pass. Earlier workflow actionlint and isolated production Worker dry-run checks remain recorded in the release-preparation evidence.

The shared-results test now waits for both guests' accepted insurance decisions and hand/phase changes before choosing the next action. The failed CI trace showed dealer blackjack immediately ending insurance while the test waited for a nonexistent Stand button. A deterministic runtime regression covers that exact hand and host continuation. The final 81-check run passes with four workers; a separate 100-attempt stress run completed 92 scenarios, with eight stopped before gameplay by confirmed HTTP 429 connection limits. Deployment settings, retries and timeouts were preserved.

Rules and asset credits are included in the [deployment guide](DEPLOYMENT.md#rules-and-assets); local setup is in the [README](README.md). [DEPLOYMENT.md](DEPLOYMENT.md) covers configuration, order, smoke testing and rollback limits. These local results do not establish hosted CI or live API/HTTPS smoke-test results for the latest fix.

## Before announcing a public release

- [ ] Configure the actual GitHub repository/default branch, GitHub Pages source and release environments.
- [ ] Configure the real account-scoped Cloudflare token, account ID, stable Worker name, unused limiter namespace and exact frontend origins.
- [ ] Run GitHub-hosted **Checks** successfully on the release commit. Local validation cannot establish runner permissions or repository/environment settings.
- [ ] Deploy the Worker, verify its actual URL, then deploy Pages. Confirm the health/protocol/CORS gate and record both deployment identities.
- [ ] Complete the live four-player, refresh, network-loss, replacement-tab and invitation tests in the deployment guide.
- [ ] Check table chat delivery, room isolation and reload history on the deployed Worker/frontend pair.
- [ ] Record remaining Milestone 6 limitations explicitly wherever the release is described.

## Milestone 6 backlog

- [x] Independent classic and large-index card faces.
- [x] Independent traditional and geometric card backs.
- [x] Save each appearance preference while preserving hands, connection and card animation identity.
- [ ] Complete enlarged-text, keyboard, contrast, touch-target and reduced-motion audit.
- [ ] Safari and physical-iPhone testing, including browser bars, safe areas, orientation and the on-screen keyboard.
- [ ] Preserve the requirement that mobile gameplay fits one screen without scrolling.
- [ ] Update the desktop UI to fit the table, game controls and chat within one screen without page scrolling.
- [ ] Update the dealer's displayed score after each card is revealed, counting only revealed cards throughout the reveal animation.

No production room backup/export, public-network load test, live Cloudflare incident test or physical-device acceptance is established by the local suite.
