# Deploying The Casual Table

The frontend is a static GitHub Pages site. Multiplayer runs separately on a Cloudflare Worker with one SQLite-backed Durable Object per room. GitHub Pages cannot run that server. Local development needs neither cloud credentials nor a production deployment.

The remaining appearance selectors, accessibility audit and Safari/device validation are **Milestone 6**. They do not block the Milestone 5 release-preparation work, but remain explicit release limitations. See the [README](README.md) and [release checks](RELEASE_CHECKLIST.md).

## Workflows

| File | Trigger | Result |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push, pull request, manual run, or reusable call | Locked install, lint, unit/runtime checks, typecheck/build, Chromium acceptance against `/casual-check/`, production Worker dry run |
| `.github/workflows/deploy-worker.yml` | Manual, default branch only | Runs checks, then deploys the isolated production Worker from the `production` environment |
| `.github/workflows/deploy-pages.yml` | Manual, default branch only | Runs checks, builds with explicit HTTPS API settings, checks live API/CORS, then publishes the frontend |

Deployments are serialized per service and are not cancelled halfway through. The workflows use the checked-in Node version and lockfile. No deployment occurs just by pushing source. CI uses local-only Wrangler and dummy production identifiers for dry runs; it needs no Cloudflare secrets.

## Configure Cloudflare first

Sign in to the intended Cloudflare account and open **Workers & Pages**. Complete first-time onboarding and register the account's `workers.dev` subdomain before running a deployment workflow. This account subdomain is separate from the app's Worker name. For example, an account subdomain of `bretts-table` and Worker name `the-casual-table-api-production` produce `https://the-casual-table-api-production.bretts-table.workers.dev`.

If Wrangler reports **You need to register a workers.dev subdomain before publishing to workers.dev**, open the dashboard onboarding link printed in the error and complete that setup. If the link does not open, navigate to **Workers & Pages** in the same account and look for the subdomain/onboarding settings. GitHub Actions is non-interactive and declines Wrangler's registration prompt; rerunning alone will not register the subdomain. After registering it, rerun the failed Worker deployment job. Registration does not require changing the app's Worker name, limiter namespace or SQLite migration.

See [Cloudflare's workers.dev configuration](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Configure GitHub

1. Push the source and lockfile to your intended GitHub repository and default branch. This checkout currently has no configured remote; creating or publishing a repository is a separate action.
2. In **Settings → Pages**, select **GitHub Actions** as the build/deployment source. Configure any custom domain and HTTPS there before choosing the frontend origin.
3. Create an environment named `production` for Worker credentials/configuration. Restrict it to the default branch; enable required reviewers where available if you want a release approval gate. The Pages job uses GitHub's `github-pages` environment; set its branch restrictions too.
4. Add the following Actions configuration. Account IDs, API URLs and origins are configuration, not API tokens. Keep the token in a secret; never put it in `VITE_*`, source, a frontend artifact or chat.

| Name | Location | Value |
| --- | --- | --- |
| `PAGES_BASE_PATH` | Repository variable | `/repository-name/` for a project site, `/` for a user/organization root site or custom domain |
| `PAGES_ORIGIN` | Repository variable | Exact frontend origin, such as `https://owner.github.io`; no repository path |
| `VITE_API_BASE_URL` | Repository variable | Deployed Worker HTTPS origin, such as `https://the-casual-table-api-production.account-subdomain.workers.dev`; no `/api` suffix |
| `CLOUDFLARE_ACCOUNT_ID` | `production` environment variable | Cloudflare's 32-character account ID |
| `CLOUDFLARE_WORKER_NAME` | `production` environment variable | A stable, distinct production name, such as `the-casual-table-api-production` |
| `CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID` | `production` environment variable | An unused numeric namespace ID chosen for this app in your account; distinct from local example `102801` |
| `ALLOWED_ORIGINS` | `production` environment variable | Exact frontend HTTPS origin(s), comma separated; include `PAGES_ORIGIN`, without the repository path |
| `CLOUDFLARE_API_TOKEN` | `production` environment **secret** | Cloudflare API token scoped to the intended account with the permissions needed to deploy Workers and Durable Objects |

For a project at `https://owner.github.io/the-usual-table/`, use `/the-usual-table/` for the base path and `https://owner.github.io` for both the Pages origin and backend allowlist. The product name does not determine the repository URL. A custom domain normally uses `/` and its own HTTPS origin. Follow Cloudflare's current token setup and account permissions guidance linked below; this project does not enable a paid plan or provision resources automatically from local checks.

## Deploy in order

1. Confirm **Checks** passes on the intended default-branch commit. Review configuration and the residual limitations in the release checklist.
2. Manually run **Deploy Cloudflare Worker** on that branch. The workflow reruns the checks and validates the production bundle before deployment. Wrangler applies the existing `v1` migration creating the SQLite-backed `TableRoom` class. Keep the Worker name and binding stable on subsequent releases to retain rooms.
3. Confirm the API's actual HTTPS URL and set `VITE_API_BASE_URL`. `workers.dev` is enabled in the generated production config; version preview URLs are disabled. The account subdomain must already be registered as described above.
4. Manually run **Deploy frontend to GitHub Pages**. It refuses missing configuration, HTTP/localhost APIs and malformed base paths. A read-only health/protocol/CORS preflight must pass before the artifact is uploaded for publishing. That preflight does not create guests or rooms and cannot establish multiplayer correctness by itself.
5. Complete the production smoke checks below on the real HTTPS URLs. Record the frontend commit, Worker deployment/version, URLs, time and results before announcing the release.

There is no backend account token in the Pages workflow. Its deployment job has only `pages: write` and `id-token: write`; check/build jobs use read-only repository access. Worker secrets are only supplied to the actual deploy step after validation.

## Local release checks

Use `npm ci`, then `npm run lint`, `npm test` and `npm run build`. Install Chromium with `npx playwright install chromium` if necessary.

The full production subpath check below uses separate ports, so a normal port-5173 development server can remain running. It builds a production frontend against a **local** Worker; it does not publish anything:

```powershell
$env:VITE_BASE_PATH='/casual-check/'
$env:VITE_API_BASE_URL='http://127.0.0.1:8788'
npm run build
$env:E2E_BASE_PATH='/casual-check/'
$env:E2E_PREVIEW='1'
$env:E2E_WEB_PORT='5175'
$env:E2E_API_PORT='8788'
npm run test:e2e -- --workers=4
Remove-Item Env:VITE_BASE_PATH, Env:VITE_API_BASE_URL, Env:E2E_BASE_PATH, Env:E2E_PREVIEW, Env:E2E_WEB_PORT, Env:E2E_API_PORT
```

For the guarded Pages release build, set the real `VITE_BASE_PATH` and HTTPS `VITE_API_BASE_URL` in the shell, then run `npm run build:pages`. Set `PAGES_ORIGIN` and run `npm run check:api` for the read-only live backend preflight. These commands read shell variables, not a deployment `.env` file. Vite's ordinary development configuration still supports `.env.local`.

To validate production Worker configuration offline, set the documented Worker variables in the shell and run `npm run deploy:worker -- --dry-run`. No API token is needed for a dry run. Use a dummy 32-character account ID and an HTTPS example origin for offline checks. The generated configuration lives under ignored `apps/server/.wrangler/release/`; it preserves the checked-in binding/migration while separating the production Worker name, origin list and limiter namespace from local examples. It contains no API token. Do not hand-edit or commit generated configs.

## Production smoke test

- Open the actual Pages URL: title, scripts, styles and card assets load with no 404s. Enter practice, finish a round, and refresh under the repository path.
- Create an online room; open its copied `#/room/…` invitation in independent browser profiles/devices. Play with four guests; confirm a fifth is rejected and duplicate names remain distinct seats.
- Open **Chat**, exchange messages, check unread counts while closed, then reload a guest and confirm the recent messages return. Check a different table sees none of those messages. On a phone, close chat and confirm the game still fits on one screen; while your hand is active, chat should show its remaining time and a return button.
- Open betting, lock wagers, play and settle; all clients agree on cards and balances. Hit resets the 20-second timer, expiry stands once, and the dealer hole card stays private until reveal.
- Check Max Bet uses available funds and the 100-chip cap, Double is restricted to initial totals of 9–11, bust totals stay visible, and Ready/waiting seats are distinct. Results should show each guest's outcome/net chips, then automatically open betting after a shared 10-second window. Check the host can skip it immediately without a late alarm resetting the next wager window.
- Reload a participating guest and test temporary network loss/recovery without extra seats, wagers or a new shoe. Open a second controlling tab and confirm the first stays displaced.
- Check phone portrait/landscape, browser bars, safe areas, split-hand selection and reachable controls. Safari/physical-device and full accessibility acceptance remain tracked in Milestone 6; record any issues there.
- Check CORS for the actual frontend origin and confirm an unrelated origin cannot open a WebSocket. Never copy guest credentials, socket tickets or private room state into screenshots, logs or issue reports.

## Rollback and state limits

Chat is an additive feature on protocol 1: new clients offer the `casual-chat-v1` capability on their authenticated socket. The Worker sends chat events only to clients that offer that capability, so older clients can continue playing during rollout. Deploy the Worker first, then the frontend. Older backends can still serve the game to the new frontend, but chat remains unavailable until the backend is updated. No new variables, bindings or Durable Object migration are needed. Chat history has its own bounded storage key/schema and is deleted with the expired room; it is not part of the game-state schema or a backup system.

The results window adds an optional persisted `roundDeadline` to stored room schema 2 and public snapshots. It includes a fixed dealer-reveal allowance plus 10 seconds for results; the animation durations are shared by the server and frontend. Reduced-motion clients use the same authoritative deadline. Reconnecting, refilling and chat do not restart it. Existing completed rooms without this field use their last engine timestamp for a stable fallback, while explicit null pauses progression with no connected guests. The existing Durable Object migration/binding and game shoe are preserved. Deploy both backend and frontend to apply the revised doubling rule and results behavior consistently.

The frontend artifact and Worker are separate releases. Record compatible commits/versions and deploy the backend first. Restore a previously tested frontend by redeploying that source commit through the same build process, or revert the relevant change onto the default branch and run the manual workflow. Pages workflows intentionally publish only from the default branch.

Use Cloudflare's supported Worker rollback/version controls for code rollback only after checking stored-state compatibility. **Rolling back code does not roll back Durable Object storage, wagers, payouts or schema migrations.** The current stored schema is 2 and can migrate schema 1; unsupported/corrupt state is preserved and fails closed. An older server may not read newer stored rooms. Prefer a forward fix when storage changed; never delete rooms, change Worker identity, or remove/reorder migration tags as a shortcut. A room credential/reservation expiry is not restored by a frontend rollback.

Local `.wrangler` stores and the cloud Worker are separate state. Existing production rooms remain with their original Worker/namespace. This repository contains no production room backup/export mechanism. Monitor the account's actual limits and errors during the smoke test; local Chromium and workerd checks do not prove public network or Cloudflare incident behavior.

## Rules and assets

The game uses six physical 52-card decks and half-chip integer accounting. Dealer stands on all 17s; an American hole-card peek follows an ace/ten-value upcard. An unsplit two-card natural pays 3:2, ordinary wins pay 1:1, pushes return the wager, and losses return nothing. Insurance is offered before an ace peek, costs up to half the original wager and pays 2:1 profit. Bets are 10–100 play chips in increments of 10; no money, purchases or cash value.

Only identical ranks split, up to four hands; split aces get one additional card and cannot resplit. Split 21 is an ordinary win. Double only on an initial two-card total of 9, 10 or 11, including after a split; it requires an equal extra wager and receives exactly one card. Each active hand gets 20 seconds; every accepted Hit resets it. Expiry stands automatically. The same shoe persists across rounds and reshuffles only before a deal at the cut/safety-reserve boundary. Disconnected guests get a 60-second reservation; committed hands settle before seat reuse.

Card faces in `apps/web/src/PlayingCard.tsx` are original inline SVG. Card backs, chips, felt texture and brand mark use original CSS/Unicode. System fonts are Georgia, Segoe UI, Arial and generic fallbacks. No downloaded art, generated raster image, third-party font or asset hotlink is bundled; no additional artwork/font licence is required. Dependency licences remain with their packages.

## Provider references

- [GitHub Pages workflow configuration and deployment permissions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite deployment and repository base paths](https://vite.dev/guide/static-deploy#github-pages)
- [Cloudflare GitHub Actions authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler bindings and migrations](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare rate-limit binding configuration](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Worker rollback guidance](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)
