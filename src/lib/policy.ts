/**
 * Policy resolver with center → global → default cascade.
 *
 * Resolution order for `getPolicyValue(key, centerId)`:
 *   1. CenterPolicy row matching (centerId, key)        — per-center override
 *   2. Policy row matching key                            — global default
 *   3. The optional fallback supplied by the caller       — code default
 *
 * This file replaces direct `prisma.policy.findUnique({ where: { key } })`
 * calls. Old code that hit the global Policy table directly keeps working
 * because we never moved or removed those rows — center-specific overrides
 * are stored in the new `CenterPolicy` table.
 *
 * In-memory caching mirrors `policy-cache.ts` (60s TTL, 5min for known
 * config keys). Cache key is `${centerId ?? '_global'}::${key}`.
 */

import { prisma } from '@/lib/prisma';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;
const TTL_OVERRIDES: Record<string, number> = {
  PRICING_CONFIG: 5 * 60_000,
  TIME_SLAB_CONFIG: 5 * 60_000,
  MACHINE_PITCH_CONFIG: 5 * 60_000,
};

function cacheKey(centerId: string | null, key: string): string {
  return `${centerId ?? '_global'}::${key}`;
}

function ttlFor(key: string): number {
  return TTL_OVERRIDES[key] ?? DEFAULT_TTL_MS;
}

/**
 * Get the resolved string value for a policy key at a given center.
 *
 * @param key       Policy key (e.g. 'PRICING_CONFIG').
 * @param centerId  Center to scope to. Pass null for the bare global lookup.
 * @param fallback  Optional code-level default returned if neither table has the key.
 */
export async function getPolicyValue(
  key: string,
  centerId: string | null,
  fallback: string | null = null,
): Promise<string | null> {
  const now = Date.now();

  // 1. Center-specific override
  if (centerId) {
    const centerKey = cacheKey(centerId, key);
    const cached = cache.get(centerKey);
    if (cached && cached.expiresAt > now) {
      if (cached.value !== null) return cached.value;
      // Cached miss — fall through to global lookup.
    } else {
      const row = await prisma.centerPolicy.findUnique({
        where: { centerId_key: { centerId, key } },
      });
      if (row) {
        cache.set(centerKey, { value: row.value, expiresAt: now + ttlFor(key) });
        return row.value;
      }
      // Cache the miss with a short TTL so we re-check soon.
      cache.set(centerKey, { value: null, expiresAt: now + 10_000 });
    }
  }

  // 2. Global default
  const globalKey = cacheKey(null, key);
  const cachedGlobal = cache.get(globalKey);
  if (cachedGlobal && cachedGlobal.expiresAt > now) {
    return cachedGlobal.value ?? fallback;
  }
  const policy = await prisma.policy.findUnique({ where: { key } });
  if (policy) {
    cache.set(globalKey, { value: policy.value, expiresAt: now + ttlFor(key) });
    return policy.value;
  }
  cache.set(globalKey, { value: null, expiresAt: now + 10_000 });
  return fallback;
}

/** Convenience: parse the resolved value as JSON, or return fallback. */
export async function getPolicyJson<T>(
  key: string,
  centerId: string | null,
  fallback: T,
): Promise<T> {
  const raw = await getPolicyValue(key, centerId, null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Convenience: resolved value === 'true'. Used for boolean feature flags. */
export async function isPolicyEnabled(
  key: string,
  centerId: string | null,
  defaultValue = false,
): Promise<boolean> {
  const raw = await getPolicyValue(key, centerId, null);
  if (raw === null) return defaultValue;
  return raw === 'true';
}

/** Invalidate cached entries for a key — for the given center, or all centers. */
export function invalidatePolicy(key: string, centerId?: string | null): void {
  if (centerId === undefined) {
    // Invalidate every variant of this key.
    for (const k of Array.from(cache.keys())) {
      if (k.endsWith(`::${key}`)) cache.delete(k);
    }
    return;
  }
  cache.delete(cacheKey(centerId, key));
}

export function invalidateAllPolicies(): void {
  cache.clear();
}
