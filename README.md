# The Usual Table

A social table-game app with Blackjack and Crash, using virtual chips only.

Project guides and development notes are maintained locally in the Git-ignored `docs/` folder.

## Duck Race practice prototype

Duck Race is available as a local, single-player practice game from the game catalog. Each race uses temporary browser-only chips, four randomly named ducks, a maximum wager of 1,000 chips, and a 4× total return on a winning wager. Refreshing or leaving the page resets the practice session.

**For Brett:** please add multiplayer room support before treating Duck Race as a shared table. The current prototype chooses its winner and settles bets in the browser. A multiplayer implementation needs an authoritative server-side race and settlement, shared room snapshots and synchronized timing, reconnection and seat handling, and tests for the complete round lifecycle. Saved-chip funding should be integrated only when server-side settlement is in place.
