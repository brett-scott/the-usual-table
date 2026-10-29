# The Casual Table

Casual blackjack without money. Guest names, practice chips, and a comfortable table.

**Milestones 1–3 and the mobile layout are implemented.** Milestone 5 adds CI and release preparation for GitHub Pages plus the Cloudflare Worker. Milestone 6 card choices are implemented; the full accessibility and physical-device audit remains. Everything can run locally without cloud credentials. No cloud service or site has been deployed.

## Run locally

Install Node.js 22.12+ (Node 24 LTS recommended), then from the repository root:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The Worker runs at **http://127.0.0.1:8787**. Enter a display name and choose **Create a table with friends**, then use **Invite** to share the room link. Invitees enter a name and take one of four seats. The host selects **Open betting**; everyone places a wager and selects **Ready** or **Sit out**. Betting closes after 30 seconds, or early when every eligible seat has decided. After the dealer reveal, results stay visible for 10 seconds and betting opens automatically. The host can select Next round to skip the pause.

To try four devices on one computer, use four independent browser profiles/contexts. A second tab in the same profile restores the same guest and replaces its previous controlling connection. Duplicate names are allowed; seat numbers distinguish players. A fifth guest receives a Table full message.

Before taking a seat, optionally choose one of 16 emoji **Player icons**, or keep **Use my initial**. Your choice is remembered in this browser and shared at your seat with everyone in the room, including on phones. Reloading an online table restores the icon belonging to that guest seat.

For solo practice, choose **Take a practice seat** and **Deal me in** after choosing a wager. `npm run dev:practice` starts just the frontend, without a Worker. Both modes support hit, stand, double, split, insurance and the same six-deck rules. Start with 1,000 play chips; refill is available below the 10-chip minimum between rounds.

Names and table themes are remembered when browser storage is available. Online guest credentials are stored locally per room: reload restores that seat and a current snapshot; clearing browser data loses access. Practice hands/balances live in memory and reset on reload. Classic and Midnight tables are available. The Cards button lets you independently choose classic or large-index faces and traditional or geometric backs; these personal choices are saved in your browser and preserve the current hand.

On phones, the table and actions fit the visible screen in portrait and landscape. Split hands use tabs that follow the playing hand automatically; tap another tab to inspect it. Opponent seats show compact hand totals, and long hands overlap their cards to stay on one row. The layout adjusts to browser bars and safe areas without scrolling the game page.

Shared tables show chat in a persistent right-hand panel on wide desktop screens. Smaller screens use **Chat** in the header. Messages show the sender's name, seat and local time, with unread counts while chat is closed. The latest 50 messages are saved for guests joining/reconnecting to that table and are removed when the room expires. Messages allow up to 300 characters, with five sends per guest every 10 seconds. New messages also appear above the sending player for five seconds: table bubbles show an 80-character preview, limited to three visual lines. The full text stays in chat; initial history is never replayed as bubbles. Chat is text only and does not change bets, turn order or hand deadlines. The mobile chat panel keeps its message list inside the screen; if your hand is playing, a countdown and **Back to hand** button remain visible. Solo practice has no table chat.

Disconnected seats are reserved for **60 seconds after the server detects the disconnect**. Reconnecting within that time restores the same seat, hand, balance and shoe. Expired seats become available only after their locked wager/current hands have settled. The table host transfers to a connected guest when needed. Offline actions are disabled; uncertain actions are checked through a fresh snapshot rather than replayed. A newer tab takes control of the seat, and older tabs stay displaced.

Cards deal from the shoe and flip face up one at a time. The dealer's hole card stays face down until reveal. Each active hand has a **20-second countdown**; every accepted **Hit resets it to 20 seconds**. Expiry stands the hand automatically, and the next split hand receives a fresh timer. Reduced-motion preferences show cards immediately.

**Max Bet** selects the highest legal base wager your balance supports, up to 100 chips in 10-chip steps. Double is available only on an initial two-card total of **9, 10 or 11**, including eligible split hands. Busted hands keep their numeric total visible. Ready and waiting seats have distinct labels and outlines. Dealer draws pause for half a second after each card finishes flipping; results show who won, lost or broke even, including their net chip change. A shared **10-second results countdown** follows the reveal before the next betting window opens. The host can select **Next round** immediately to skip the reveal/pause; solo practice also supports automatic progression and skipping.

Chip stacks show the selected/locked bet and each hand's actual wager, including splits and doubles. They move onto the felt, are collected for losses, and return with payout chips for wins. Chip movement is visual only; server balances and deadlines remain authoritative. Reduced motion shows the current stakes without flying chips.

## Commands

| Command | Result |
| --- | --- |
| `npm ci` | Install exact locked dependencies |
| `npm run dev:practice` | Start the Vite practice frontend |
| `npm run dev` | Start frontend and local Worker together |
| `npm run dev:server` | Start only the local Worker/Durable Object service |
| `npm run typecheck` | Strict TypeScript workspace checks |
| `npm run lint` | ESLint source checks |
| `npm test` | Engine/presentation tests, then Cloudflare runtime integration tests |
| `npm run test:e2e` | Chromium desktop, phone and landscape checks |
| `npm run build` | Typecheck, build frontend to `apps/web/dist/`, and validate Worker via Wrangler dry run |
| `npm run build:pages` | Build the frontend with required base path and public HTTPS API configuration |
| `npm run check:api` | Read-only live API health, protocol and frontend CORS preflight |
| `npm run deploy:worker -- --dry-run` | Validate isolated production Worker settings without deployment |
| `npm run preview -w @casual/web` | Preview the production build |

Install the browser once with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing compatible Chromium executable. Phone profiles simulate viewports/input; these are not tests on physical iPhones or Safari.

Keep ports 5173 and 8787 free before starting `npm run dev`. Optional shell variables `WEB_PORT`, `API_PORT` and `ALLOWED_ORIGINS` configure alternate local ports/origins; the combined launcher passes the matching public API URL to Vite. Stop the combined launcher with Ctrl+C. Wrangler's local development state lives under `apps/server/.wrangler/`; browser tests use a separate local persistence path. Cloudflare integration tests run isolated from both. Cloudflare's supported test plugin uses Vitest 4.1 in the server workspace; engine/UI tests retain Vitest 5.

## Workspace

- `apps/web`: React UI, CSS Modules, original SVG cards, practice and online `GameClient` adapters.
- `apps/server`: Worker routes, hibernating room WebSockets, guest authentication, SQLite-backed state, command receipts and durable alarms.
- Shared-table chat uses the existing authenticated connection and separate bounded durable history; no additional service or deployment variable is required.
- `packages/engine`: pure shoe, scoring, transitions, actions and settlement. Randomness/time are injected.
- `packages/protocol`: versioned public DTOs, Zod commands, and shared adapter interface.
- `tests/e2e`: round, split/double/hit, insurance, keyboard, and responsive checks.
- `.github/workflows`: validation plus separate manual frontend/backend deployment workflows.
- [Deployment guide](DEPLOYMENT.md), [release checklist](RELEASE_CHECKLIST.md), [rules and asset credits](DEPLOYMENT.md#rules-and-assets). Detailed local development notes remain under ignored `docs/`.

All engine/protocol monetary fields use **integer half-chip units**. UI amounts convert to displayed chips. The Worker controls online cards, balances and deadlines; the browser engine is used only for local practice. The same UI consumes public snapshots through either adapter.

## GitHub Pages base path

Copy `.env.example` to `.env.local` if needed. Set `VITE_BASE_PATH=/your-repository/` for a Pages project site, or `/` for a root/custom-domain site, then build. This is public configuration, never a credential.

Run the browser suite against a production subpath build in PowerShell:

```powershell
$env:VITE_BASE_PATH='/casual-check/'
$env:VITE_API_BASE_URL='http://127.0.0.1:8788'
npm run build
$env:E2E_BASE_PATH='/casual-check/'
$env:E2E_PREVIEW='1'
$env:E2E_WEB_PORT='5175'
$env:E2E_API_PORT='8788'
npm run test:e2e
Remove-Item Env:VITE_BASE_PATH, Env:VITE_API_BASE_URL, Env:E2E_BASE_PATH, Env:E2E_PREVIEW, Env:E2E_WEB_PORT, Env:E2E_API_PORT
```

Ports 5175 and 8788 must be free for this production check. GitHub Pages serves static frontend files; it cannot run the online game server. Public builds require `VITE_API_BASE_URL` pointing at the deployed HTTPS Worker. Configure `ALLOWED_ORIGINS` with the frontend's exact origin (no path), and give the production rate-limit namespace an unused numeric ID in your account.

If the regular frontend is already running, set `E2E_WEB_PORT=5175` for a separate test preview; `E2E_API_PORT` can also select a different Worker port. Build with a matching `VITE_API_BASE_URL` when changing the production test's API port.

Separate workflows validate changes and manually deploy the Worker and Pages frontend. Both deploy workflows rerun checks and accept the default branch only. See the [deployment guide](DEPLOYMENT.md) for repository/environment variables, Cloudflare secrets, deployment order, rollback limits and the live smoke test. No publishing is triggered by a push alone.

Stored rooms upgrade from schema 1 to 2 without replacing the shoe or resetting wagers/deadlines. Unsupported or invalid stored state is preserved and fails safely. The remaining Milestone 6 work is the full accessibility and Safari/device audit.

The local handoff records the original design plus the current milestone direction and is excluded from Git. The official product name is **The Casual Table**, regardless of the repository folder name.
