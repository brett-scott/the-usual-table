/* global URL */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { httpsOrigin, pagesConfig, workerConfig } from './release-config.mjs';

const base = JSON.parse(readFileSync(new URL('../apps/server/wrangler.jsonc', import.meta.url), 'utf8'));
const production = { CLOUDFLARE_WORKER_NAME: 'the-casual-table-api-production', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID: '102802', ALLOWED_ORIGINS: 'https://player.github.io' };

describe('release boundaries', () => {
  it('refuses missing Pages configuration instead of shipping the localhost API fallback', () => {
    expect(() => pagesConfig({ VITE_BASE_PATH: '/' })).toThrow('VITE_API_BASE_URL');
    expect(() => pagesConfig({ VITE_API_BASE_URL: 'https://api.example.test' })).toThrow('VITE_BASE_PATH');
    expect(pagesConfig({ VITE_BASE_PATH: '/the-usual-table/', VITE_API_BASE_URL: 'https://api.example.test/' })).toEqual({ base: '/the-usual-table/', api: 'https://api.example.test' });
  });
  it.each(['http://127.0.0.1:8787', 'https://localhost', 'https://api.example.test/path', 'https://user:secret@api.example.test', 'https://api.example.test/?key=secret', '*'])('rejects unsafe or ambiguous API/origin configuration: %s', value => {
    expect(() => httpsOrigin(value, 'origin')).toThrow();
    expect(() => workerConfig(base, { ...production, ALLOWED_ORIGINS: value })).toThrow();
  });
  it('rejects traversal and incomplete repository paths', () => {
    for (const basePath of ['/repo', 'repo/', '/repo/../', '//']) expect(() => pagesConfig({ VITE_BASE_PATH: basePath, VITE_API_BASE_URL: 'https://api.example.test' })).toThrow('VITE_BASE_PATH');
  });
  it('keeps bindings and migrations while isolating production identity and origins', () => {
    const config = workerConfig(base, { ...production, ALLOWED_ORIGINS: 'https://player.github.io/,https://table.example.test,https://player.github.io' });
    expect(config.name).not.toBe(base.name); expect(config.ratelimits[0].namespace_id).not.toBe(base.ratelimits[0].namespace_id);
    expect(config.vars.ALLOWED_ORIGINS).toBe('https://player.github.io,https://table.example.test');
    expect(config.durable_objects).toEqual(base.durable_objects); expect(config.migrations).toEqual(base.migrations);
    expect(base.vars.ALLOWED_ORIGINS).toContain('localhost'); expect(config.preview_urls).toBe(false);
  });
  it('refuses a missing account, a reused Worker identity or the example limiter namespace', () => {
    expect(() => workerConfig(base, { ...production, CLOUDFLARE_ACCOUNT_ID: '' })).toThrow('CLOUDFLARE_ACCOUNT_ID');
    expect(() => workerConfig(base, { ...production, CLOUDFLARE_WORKER_NAME: base.name })).toThrow('distinct production');
    expect(() => workerConfig(base, { ...production, CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID: base.ratelimits[0].namespace_id })).toThrow('distinct from the local example');
  });
});
