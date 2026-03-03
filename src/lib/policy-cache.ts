import { prisma } from '@/lib/prisma';

/**
 * In-memory policy cache with TTL.
 * Caches Policy table values to avoid repeated DB hits on every request.
 * TTL is configurable per key type. Defaults to 60 seconds.
 *
 * On Vercel serverless, each function instance has its own cache.
 * The short TTL ensures eventual consistency while avoiding DB roundtrips.
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Default TTL: 60 seconds — good balance between freshness and performance
const DEFAULT_TTL_MS = 60_000;

// Longer TTL for rarely-changing configs
const TTL_OVERRIDES: Record<string, number> = {
  PRICING_CONFIG: 5 * 60_000,       // 5 minutes
  TIME_SLAB_CONFIG: 5 * 60_000,     // 5 minutes
  MACHINE_PITCH_CONFIG: 5 * 60_000, // 5 minutes
};

/**
 * Get a single policy value from cache or DB.
 */
export async function getCachedPolicy(key: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const policy = await prisma.policy.findUnique({ where: { key } });

  if (policy) {
    const ttl = TTL_OVERRIDES[key] ?? DEFAULT_TTL_MS;
    cache.set(key, { value: policy.value, expiresAt: now + ttl });
    return policy.value;
  }

  // Cache the miss too (with shorter TTL) to avoid repeated DB lookups
  cache.set(key, { value: '', expiresAt: now + 10_000 });
  return null;
}

/**
 * Get multiple policy values in a single DB query.
 * Returns a Record<key, value> for found keys.
 */
export async function getCachedPolicies(keys: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const missingKeys: string[] = [];

  // Check cache first
  for (const key of keys) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      if (cached.value !== '') {
        result[key] = cached.value;
      }
    } else {
      missingKeys.push(key);
    }
  }

  // Fetch all missing keys in a single query
  if (missingKeys.length > 0) {
    const policies = await prisma.policy.findMany({
      where: { key: { in: missingKeys } },
    });

    const foundKeys = new Set<string>();
    for (const policy of policies) {
      const ttl = TTL_OVERRIDES[policy.key] ?? DEFAULT_TTL_MS;
      cache.set(policy.key, { value: policy.value, expiresAt: now + ttl });
      result[policy.key] = policy.value;
      foundKeys.add(policy.key);
    }

    // Cache misses too
    for (const key of missingKeys) {
      if (!foundKeys.has(key)) {
        cache.set(key, { value: '', expiresAt: now + 10_000 });
      }
    }
  }

  return result;
}

/**
 * Invalidate specific keys from cache (call after admin updates a policy).
 */
export function invalidatePolicyCache(...keys: string[]): void {
  if (keys.length === 0) {
    cache.clear();
  } else {
    for (const key of keys) {
      cache.delete(key);
    }
  }
}
