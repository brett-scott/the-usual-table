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

Local verification: 75 engine/presentation/transport/release tests and 41 Cloudflare runtime/storage tests passed. All 49 browser checks passed against the production bundle under `/casual-check/`. Lint, TypeScript, frontend/Worker builds, isolated production Worker dry run and actionlint workflow checks passed. The browser rerun after the request-stream fix emitted no request-stream exceptions.

Rules and asset credits are included in the [deployment guide](DEPLOYMENT.md#rules-and-assets); local setup is in the [README](README.md). [DEPLOYMENT.md](DEPLOYMENT.md) covers configuration, order, smoke testing and rollback limits. GitHub-hosted workflow execution and live API/HTTPS smoke testing have not been performed.

## Before announcing a public release

- [ ] Configure the actual GitHub repository/default branch, GitHub Pages source and release environments.
- [ ] Configure the real account-scoped Cloudflare token, account ID, stable Worker name, unused limiter namespace and exact frontend origins.
- [ ] Run GitHub-hosted **Checks** successfully on the release commit. Local validation cannot establish runner permissions or repository/environment settings.
- [ ] Deploy the Worker, verify its actual URL, then deploy Pages. Confirm the health/protocol/CORS gate and record both deployment identities.
- [ ] Complete the live four-player, refresh, network-loss, replacement-tab and invitation tests in the deployment guide.
- [ ] Record remaining Milestone 6 limitations explicitly wherever the release is described.

## Milestone 6 backlog

- [ ] Independent classic and large-index/high-contrast card faces.
- [ ] Independent traditional and geometric card backs.
- [ ] Save each appearance preference while preserving hands, connection and card animation identity.
- [ ] Complete enlarged-text, keyboard, contrast, touch-target and reduced-motion audit.
- [ ] Safari and physical-iPhone testing, including browser bars, safe areas, orientation and the on-screen keyboard.
- [ ] Preserve the requirement that mobile gameplay fits one screen without scrolling.

No production room backup/export, public-network load test, live Cloudflare incident test or physical-device acceptance is established by the local suite.
