import { z } from 'zod';
import defaults from './supabase.public.json' with { type: 'json' };

// Public project configuration only. Provider secrets and privileged API/database keys never belong here.
export const PUBLIC_SUPABASE_CONFIG = defaults;
export const supabaseUrlSchema = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.pathname === '/' && !url.port && !url.username && !url.password
    && !url.search && !url.hash && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname);
}, 'Use the HTTPS Supabase project origin.').transform(value => new URL(value).origin);
export const publicAuthConfigSchema = z.object({ url: supabaseUrlSchema,
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{10,}$/, 'Use a Supabase publishable key, never a secret key.') });
export const socialProviderSchema = z.enum(['google', 'discord']);
export type SocialProvider = z.infer<typeof socialProviderSchema>;
/** Stable Supabase user UUID from the verified JWT subject; display names never identify an account. */
export const accountSessionSchema = z.object({ accountId: z.string().uuid(), provider: socialProviderSchema,
  expiresAt: z.number().int().positive().safe() }).strict();
export type AccountSession = z.infer<typeof accountSessionSchema>;
