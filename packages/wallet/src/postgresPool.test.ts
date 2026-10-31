import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { postgresPoolCloser } from './postgres';

function fixture() {
  // Model the driver's early end resolution independently of OS socket timing.
  const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => {}) });
  return { pool, close: postgresPoolCloser(pool as unknown as Pool) };
}

it('waits for every client to end even after the pool drain has resolved', async () => {
  const f = fixture(); const first = new EventEmitter(); const second = new EventEmitter();
  f.pool.emit('connect', first); f.pool.emit('connect', second);
  let stopped = false;
  const stopping = f.close().then(() => { stopped = true; });
  await Promise.resolve(); expect(f.pool.end).toHaveBeenCalledOnce(); expect(stopped).toBe(false);
  first.emit('end'); await Promise.resolve(); expect(stopped).toBe(false);
  second.emit('end'); await stopping; expect(stopped).toBe(true);
});

it('reports unexpected idle errors after closing instead of hiding them or exposing the client object', async () => {
  const f = fixture(); const client = new EventEmitter(); f.pool.emit('connect', client);
  const stopping = f.close(); await Promise.resolve();
  f.pool.emit('error', Object.assign(new Error('Connection terminated'), { code: '57P01', client: { password: 'private-test-value' } }));
  client.emit('end');
  await expect(stopping).rejects.toMatchObject({ message: 'PostgreSQL pool connection failed.', code: '57P01' });
  await expect(stopping).rejects.not.toHaveProperty('client');
});
