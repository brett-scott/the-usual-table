import type { z } from 'zod';
import { browserAuth } from './authClient';
export async function accountRequest<T>(path: string, owner: string, schema: z.ZodType<T>, method = 'GET', signal?: AbortSignal): Promise<T> {
  const auth=browserAuth();const token = await auth.accessToken();
  if(auth.getSnapshot().account?.accountId!==owner)throw new Error('Account changed');
  const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/,'');
  const response = await fetch(`${base}/api/v1/account/${path}`,{method,headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'manual',
    signal: AbortSignal.any([...(signal ? [signal] : []),AbortSignal.timeout(10000)])});
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(value && typeof value === 'object' && 'code' in value ? String(value.code) : 'UNAVAILABLE');
  const data = schema.parse(value);
  if (!data || typeof data !== 'object' || !('accountId' in data) || data.accountId !== owner) throw new Error('Account mismatch');
  return data;
}
