import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';
import { invalidatePolicyCache } from '@/lib/policy-cache';
import { invalidatePolicy } from '@/lib/policy';

/**
 * Admin policy editor — center-scoped.
 *
 * Reads merge the current center's `CenterPolicy` overrides on top of
 * the global `Policy` table, so every admin sees resolved values for
 * "their" center. Writes go to `CenterPolicy(currentCenter, key)` only
 * — the platform-wide global rows are managed separately by super
 * admins via the per-center policies tab on `/admin/centers/[id]` (or
 * by direct DB).
 *
 * The legacy global-write behaviour was removed because center-by-
 * center config is the user's mental model; persisting to a single
 * global key produced surprising cross-center bleed-through.
 */

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || (user.role !== 'ADMIN' && !user.isSuperAdmin)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
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

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    const { key, value } = await req.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
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

    const center = await resolveCurrentCenter(req, user);
    if (!center) {
      return NextResponse.json({ error: 'No center selected' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'Policy key is required' }, { status: 400 });
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
