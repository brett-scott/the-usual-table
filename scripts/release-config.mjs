/* global URL */
function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Set ${key} before preparing a release.`);
  return value;
}

export function httpsOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost') || url.hostname.startsWith('127.')) throw new Error(`${label} must be a public HTTPS origin without a path, credentials, query or fragment.`);
  return url.origin;
}

export function pagesConfig(env) {
  const base = required(env, 'VITE_BASE_PATH');
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base) || base.split('/').some(part => part === '.' || part === '..')) throw new Error('VITE_BASE_PATH must be / or a repository path such as /the-usual-table/.');
  return { base, api: httpsOrigin(required(env, 'VITE_API_BASE_URL'), 'VITE_API_BASE_URL') };
}

export function workerConfig(base, env) {
  const name = required(env, 'CLOUDFLARE_WORKER_NAME');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name) || name === base.name) throw new Error('Use a distinct production CLOUDFLARE_WORKER_NAME (lowercase letters, digits and hyphens).');
  const account = required(env, 'CLOUDFLARE_ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.');
  const namespace = required(env, 'CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID');
  if (!/^[1-9][0-9]*$/.test(namespace) || namespace === base.ratelimits[0].namespace_id) throw new Error('Choose a production CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID distinct from the local example.');
  const origins = [...new Set(required(env, 'ALLOWED_ORIGINS').split(',').map(value => httpsOrigin(value.trim(), 'ALLOWED_ORIGINS')))];
  return { ...base, name, account_id: account, workers_dev: true, preview_urls: false, vars: { ALLOWED_ORIGINS: origins.join(',') }, ratelimits: [{ ...base.ratelimits[0], namespace_id: namespace }] };
}
