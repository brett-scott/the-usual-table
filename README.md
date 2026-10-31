# The Usual Table

Casual table games without money. Blackjack is playable; Baccarat, Roulette, Texas Hold'em Poker, Keno, Duck Race, Penguin Cross and Crash are planned. Guest names, play chips, and a comfortable table.

**Milestones 1–3 and the mobile layout are implemented.** Milestone 5 adds CI and release preparation for GitHub Pages plus the Cloudflare Worker. Milestone 6 card choices are implemented; the full accessibility and physical-device audit remains. Local guest gameplay and automated tests need no privileged cloud credentials. Changes made in this workspace are not automatically deployed.

## Run locally

Install Node.js 22.12+ (Node 24 LTS recommended), then from the repository root:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The Worker runs at **http://127.0.0.1:8787**. Choose **Find a Table** on the Blackjack home tile to browse public lobbies. **Create a table** opens a form with public/private visibility; private is the default. Signed-in players use their saved nickname and icon automatically; guests enter a display name and can choose an icon. Use **Invite** to share a room link, with up to four seats. The host selects **Open betting**; everyone places a wager and selects **Ready** or **Sit out**. Betting closes after 30 seconds, or early when every eligible seat has decided. After the dealer reveal, results stay visible for 10 seconds and betting opens automatically. The host can select Next round to skip the pause.

Tables default to **Private · Invite only**. Choose **Public · Listed** before creating a room to include it in **Find a table**. The public browser shows tables with open seats, updates automatically, and checks availability again when joining. Private rooms never appear there. Existing invitation links still work, and **Return to your last table** restores your guest credential or signed-in account seat while its reservation is valid. All seven [future games](FUTURE_GAMES.md) are marked **Coming soon**, with no placeholder game controls. All eight catalog entries fit together on one screen: four columns by two rows on desktop/landscape and compact two-column tiles on phones/tablets. Neither the page nor the catalog needs vertical scrolling at the tested viewport sizes; both Blackjack actions remain available.

The [platform foundations](PLATFORM_FOUNDATIONS.md) describe a shared account wallet across games, funded table stacks, per-game statistics and verified result delivery. The [wallet contracts, PostgreSQL storage and internal Blackjack integration](WALLET_STORAGE.md) are implemented and tested with local account identities, durable result delivery and safe chip returns. [Google and Discord sign-in](AUTHENTICATION.md) now has a PKCE browser flow, refresh/sign-out and Worker session verification using the configured Supabase project. Account nicknames and player icons are saved with Supabase Auth, with first-login setup and a top-right Edit nickname / Edit player icon / Sign out menu. Its Wallet balance section now connects to Supabase through caller-scoped functions. Apply the [wallet setup SQL](WALLET_SETUP.md), then deploy Worker before Pages; first use creates a saved wallet with a one-time 10,000-chip welcome grant without resetting existing funds. Signed-in Blackjack players can now choose a saved-wallet buy-in (initially 1,000 chips) or explicitly use temporary chips. Saved play requires the private [Hyperdrive connection](BLACKJACK_WALLET_SETUP.md); server results and remaining table funds persist through durable wallet commands. Full profile rows, daily/activity grants and progression remain future work. All currency is virtual play chips, with no purchase or real-money redemption value.

Choose **Sign in** on the games hub or Blackjack entry to use Google/Discord, or keep playing without an account. Login returns to the game/invitation you opened, and entry name/icon choices remain intact. The project URL and publishable key are public, checked-in configuration; local startup needs no administrator credentials. See [authentication setup and deployment order](AUTHENTICATION.md).

Accounts have a stable, unique account ID. Display names/usernames **do not need to be unique**; changing a name will not change the account or its ownership. Saved profiles and future wallet/statistics/progression data use the account ID, never the display name.

To try four devices on one computer, use four independent browser profiles/contexts. A second tab in the same profile restores the same guest and replaces its previous controlling connection. Duplicate names are allowed; seat numbers distinguish players. A fifth guest receives a Table full message.

Before taking a seat, optionally choose one of 16 emoji **Player icons**, or keep **Use my initial**. Your choice is remembered in this browser and shared at your seat with everyone in the room, including on phones. Reloading an online table restores the icon belonging to that guest seat.

For solo play, create a **private table** and open betting with just yourself seated. It uses the same server-backed rules, chat, reload recovery and Leave table control as a group game; friends can join later by invitation. There is no separate practice option. **Leave table** returns to the games menu after the server accepts the leave. Guest tables currently start with 1,000 temporary play chips; refill is available below the 10-chip minimum between rounds. Saved account play is implemented locally; enable its hosted database connection using [Blackjack wallet setup](BLACKJACK_WALLET_SETUP.md). The legacy `npm run dev:practice` command starts only Vite; playable tables now require the Worker too, so use `npm run dev` for normal development.

Names and table themes are remembered when browser storage is available. Guest credentials are stored locally per room: reload restores that seat and a current snapshot; clearing browser data loses access. If persistent storage is blocked, creating/joining a table still works within the current tab, without promising reload recovery. Classic and Midnight tables are available. The Cards button lets you independently choose classic or large-index faces and traditional or geometric backs; these personal choices are saved in your browser and preserve the current hand.

On phones, the table and actions fit the visible screen in portrait and landscape. Split hands use tabs that follow the playing hand automatically; tap another tab to inspect it. Opponent seats show compact hand totals, and long hands overlap their cards to stay on one row. The layout adjusts to browser bars and safe areas without scrolling the game page.

Desktop tables also share the available viewport height between the header, game, controls and footer. Wide screens reserve the right side for chat, with its composer on screen and only message history scrolling. Laptop-size acceptance includes 1440×900, 1366×768, 1280×720 and 1024×768, four players and four split hands.

Shared tables show chat in a persistent right-hand panel on wide desktop screens. Smaller screens use **Chat** in the header. Messages show the sender's name, seat and local time, with unread counts while chat is closed. The latest 50 messages are saved for guests joining/reconnecting to that table and are removed when the room expires. Messages allow up to 300 characters, with five sends per guest every 10 seconds. New messages also appear above the sending player for five seconds: table bubbles show an 80-character preview, limited to three visual lines. The full text stays in chat; initial history is never replayed as bubbles. Chat is text only and does not change bets, turn order or hand deadlines. The mobile chat panel keeps its message list inside the screen; if your hand is playing, a countdown and **Back to hand** button remain visible. Private one-player tables have the same chat panel, ready for friends who join later.

Disconnected seats are reserved for **60 seconds after the server detects the disconnect**. Reconnecting within that time restores the same seat, hand, balance and shoe. Expired seats become available only after their locked wager/current hands have settled. The table host transfers to a connected guest when needed. Offline actions are disabled; uncertain actions are checked through a fresh snapshot rather than replayed. A newer tab takes control of the seat, and older tabs stay displaced.

Both public and private tables are deleted when the last player leaves, including their chat history and alarms. Closing a tab keeps the 60-second reconnect reservation; if nobody returns, cleanup follows its expiry. A room whose players have all left rejects old invitations immediately, while any committed hand or pending virtual-chip return finishes safely before its stored data is deleted. Public listings are removed as the table closes.

Cards deal from the shoe and flip face up one at a time. The dealer's hole card stays face down until reveal. Each active hand has a **20-second countdown**; every accepted **Hit resets it to 20 seconds**. Expiry stands the hand automatically, and the next split hand receives a fresh timer. Reduced-motion preferences show cards immediately.

**Max Bet** selects the highest legal base wager your balance supports, up to 100 chips in 10-chip steps. Double is available only on an initial two-card total of **9, 10 or 11**, including eligible split hands. Busted hands keep their numeric total visible. Ready and waiting seats have distinct labels and outlines. Dealer draws pause for half a second after each card finishes flipping; results show who won, lost or broke even, including their net chip change. A shared **10-second results countdown** follows the reveal before the next betting window opens. The host can select **Next round** immediately to skip the reveal/pause; one-player private lobbies use the same automatic progression and host skipping.

Chip stacks show the selected/locked bet and each hand's actual wager, including splits and doubles. They move onto the felt, are collected for losses, and return with payout chips for wins. Chip movement is visual only; server balances and deadlines remain authoritative. Reduced motion shows the current stakes without flying chips.

## Commands

| Command | Result |
| --- | --- |
| `npm ci` | Install exact locked dependencies |
| `npm run dev:practice` | Start only Vite (legacy command; tables require the Worker) |
| `npm run dev` | Start frontend and local Worker together |
| `npm run dev:server` | Start only the local Worker/Durable Object service |
| `npm run typecheck` | Strict TypeScript workspace checks |
| `npm run lint` | ESLint source checks |
| `npm test` | Engine/presentation/wallet tests, then Cloudflare runtime integration tests |
| `npm run test:e2e` | Chromium desktop, phone and landscape checks |
| `npm run build` | Typecheck, build frontend to `apps/web/dist/`, and validate Worker via Wrangler dry run |
| `npm run build:pages` | Build the frontend with required base path and public HTTPS API configuration |
| `npm run check:api` | Read-only live API health, protocol and frontend CORS preflight |
| `npm run wallet:prepare` | Regenerate the reviewable Supabase wallet installer from its source migrations |
| `npm run deploy:worker -- --dry-run` | Validate isolated production Worker settings without deployment |
| `npm run preview -w @casual/web` | Preview the production build |

Install the browser once with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing compatible Chromium executable. Phone profiles simulate viewports/input; these are not tests on physical iPhones or Safari.

Keep ports 5173 and 8787 free before starting `npm run dev`. Optional shell variables `WEB_PORT`, `API_PORT` and `ALLOWED_ORIGINS` configure alternate local ports/origins; the combined launcher passes the matching public API URL to Vite. Stop the combined launcher with Ctrl+C. Wrangler's local development state lives under `apps/server/.wrangler/`; browser tests use a separate local persistence path. Cloudflare integration tests run isolated from both. Cloudflare's supported test plugin uses Vitest 4.1 in the server workspace; engine/UI/wallet tests retain Vitest 5. Wallet tests also start an isolated localhost PostgreSQL process with a generated password and temporary directory, then stop and clean it up. Run as a normal non-root user; no cloud credentials, system database service or OS account creation is needed.

## Workspace

- `apps/web`: React UI, CSS Modules, original SVG cards, the online `GameClient` adapter and a test-only local engine adapter.
- `apps/server`: Worker routes, hibernating room WebSockets, guest authentication, SQLite-backed state, command receipts and durable alarms.
- Shared-table chat uses the existing authenticated connection and separate bounded durable history; no additional service or deployment variable is required.
- `packages/engine`: pure shoe, scoring, transitions, actions and settlement. Randomness/time are injected.
- `packages/protocol`: versioned public DTOs, Zod commands, and shared adapter interface.
- `packages/wallet`: trusted-server PostgreSQL wallet repository, pinned-connection adapter, private-schema migration and embedded/native PostgreSQL tests; no hosted account play is enabled yet.
- `tests/e2e`: round, split/double/hit, insurance, keyboard, and responsive checks.
- `.github/workflows`: validation plus separate manual frontend/backend deployment workflows.
- [Deployment guide](DEPLOYMENT.md), [release checklist](RELEASE_CHECKLIST.md), [rules and asset credits](DEPLOYMENT.md#rules-and-assets). Detailed local development notes remain under ignored `docs/`.

Blackjack engine/gameplay monetary fields use **integer half-chip units**. The separate account-wallet contract uses **100 integer units per virtual chip**, with explicit conversion helpers. UI amounts convert to displayed chips. The Worker controls all playable tables' cards, balances and deadlines. Deterministic browser presentation checks bundle an isolated local-engine fixture in memory through Playwright interception; the fixture is not emitted into the deployed app and exposes no production test route or shoe controls.

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

The local handoff records the original design plus the current milestone direction and is excluded from Git. The official product name is **The Usual Table**. Existing internal package scopes, browser-storage keys and WebSocket protocol identifiers retain their legacy names for compatibility with saved preferences and active rooms.
