import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser, hasMembershipRole } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { invalidatePolicyCache } from '@/lib/policy-cache';
import { invalidatePolicy } from '@/lib/policy';

/**
 * Admin policy editor — center-scoped by default; super admins can
 * opt into editing the platform-wide defaults via `?scope=global`.
 *
 * Reads merge the current center's `CenterPolicy` overrides on top of
 * the global `Policy` table, so every admin sees resolved values for
 * "their" center. Writes go to `CenterPolicy(currentCenter, key)` by
 * default. With `?scope=global`, GET returns the bare `Policy` rows
 * (no override merge) and POST/DELETE target `Policy` directly — that
 * mode is gated to super admins only and is how you change the
 * cross-center default that any new center inherits.
 */

type Scope = 'center' | 'global';

function readScope(req: NextRequest): Scope {
  const raw = new URL(req.url).searchParams.get('scope');
  return raw === 'global' ? 'global' : 'center';
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const scope = readScope(req);
    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
      }
      const policies = await prisma.policy.findMany();
      return NextResponse.json(policies.map((p) => ({ key: p.key, value: p.value })));
    }

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    const [globals, overrides] = await Promise.all([
      prisma.policy.findMany(),
      prisma.centerPolicy.findMany({ where: { centerId: center.id } }),
    ]);
    const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));
    // Resolved view: for each known key, return the override if present
    // else the global default. Frontend treats this as a flat list of
    // {key, value} — identical to the old shape, just center-specific.
    const resolved: Array<{ key: string; value: string }> = globals.map((g) => ({
      key: g.key,
      value: overrideMap.get(g.key) ?? g.value,
    }));
    // Surface overrides whose key isn't in the global set so brand-new
    // per-center policy keys still appear in the list.
    for (const o of overrides) {
      if (!resolved.find((r) => r.key === o.key)) {
        resolved.push({ key: o.key, value: o.value });
      }
    }
    return NextResponse.json(resolved);
  } catch (error) {
    console.error('Admin policies fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const scope = readScope(req);
    const { key, value } = await req.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
    }

    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
      }
      const upserted = await prisma.policy.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
      invalidatePolicy(key, null);
      invalidatePolicyCache(key);
      return NextResponse.json(upserted);
    }

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }
    // Cross-center protection: an ADMIN must hold an ADMIN membership
    // at the resolved center. Super admins always pass. Without this an
    // admin who flipped the cookie to a center they don't manage could
    // mutate that center's policies.
    if (!hasMembershipRole(user, center.id, 'ADMIN')) {
      return NextResponse.json(
        { error: 'You are not an admin at this center' },
        { status: 403 },
      );
    }

    const upserted = await prisma.centerPolicy.upsert({
      where: { centerId_key: { centerId: center.id, key } },
      update: { value: String(value) },
      create: { centerId: center.id, key, value: String(value) },
    });

    invalidatePolicy(key, center.id);
    invalidatePolicyCache(key); // legacy cache key

    return NextResponse.json(upserted);
  } catch (error) {
    console.error('Admin policy update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const scope = readScope(req);
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'Policy key is required' }, { status: 400 });
    }

    if (scope === 'global') {
      if (!user.isSuperAdmin) {
        return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
      }
      await prisma.policy.deleteMany({ where: { key } });
      invalidatePolicy(key, null);
      invalidatePolicyCache(key);
      return NextResponse.json({ message: 'Global policy removed' });
    }

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }
    if (!hasMembershipRole(user, center.id, 'ADMIN')) {
      return NextResponse.json(
        { error: 'You are not an admin at this center' },
        { status: 403 },
      );
    }

    // Removes the per-center override only; the global default stays put.
    await prisma.centerPolicy.deleteMany({ where: { centerId: center.id, key } });
    invalidatePolicy(key, center.id);
    invalidatePolicyCache(key);

    return NextResponse.json({ message: 'Policy override removed' });
  } catch (error) {
    console.error('Admin policy delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
