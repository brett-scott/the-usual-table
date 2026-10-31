import { DurableObject } from 'cloudflare:workers';
import { publicLobbySchema, type PublicLobby } from '@casual/protocol';
import type { Env } from './env';

export const LOBBY_TTL_MS = 90_000;
/** A per-game, discovery-only index. The table always decides whether a seat can be joined. */
export class LobbyDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lobbies (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, report TEXT, expires INTEGER NOT NULL)');
  }
  async update(id: string, revision: number, lobby: PublicLobby | null) {
    if (!/^[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid lobby update');
    const now = Date.now(); const report = lobby ? publicLobbySchema.parse({ ...lobby, roomId: id, updatedAt: now }) : null;
    this.ctx.storage.sql.exec(`INSERT INTO lobbies (id, revision, report, expires) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, report=excluded.report, expires=excluded.expires
      WHERE excluded.revision > lobbies.revision OR (excluded.revision = lobbies.revision AND (excluded.report IS NULL OR lobbies.report IS NOT NULL))`, id, revision, report ? JSON.stringify(report) : null, now + LOBBY_TTL_MS);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > now + LOBBY_TTL_MS) await this.ctx.storage.setAlarm(now + LOBBY_TTL_MS);
  }
  list(): PublicLobby[] {
    return [...this.ctx.storage.sql.exec<{ report: string }>("SELECT report FROM lobbies WHERE expires > ? AND report IS NOT NULL AND json_extract(report, '$.players') < json_extract(report, '$.capacity') ORDER BY expires DESC, id LIMIT 50", Date.now())]
      .map(row => publicLobbySchema.parse(JSON.parse(row.report)));
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM lobbies WHERE expires <= ?', Date.now());
    const next = this.ctx.storage.sql.exec<{ expires: number | null }>('SELECT MIN(expires) AS expires FROM lobbies').one().expires;
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}
