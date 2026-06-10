import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// GET /loc/[slug] resolves a center slug to its own mapUrl and 307s
// there. The fallback rules are what we verify: LOCATION_URL is ABCA's
// map, so it is only correct for the 'abca' / legacy 'default' slugs —
// any other center without a usable mapUrl must go to the neutral
// /centers listing, never to another center's location.

const findUniqueMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { center: { findUnique: (args: unknown) => findUniqueMock(args) } },
}));

import { GET } from '../[slug]/route';
import { LOCATION_URL } from '@/lib/client-constants';
import type { NextRequest } from 'next/server';

const req = (slug: string) =>
  ({ nextUrl: new URL(`https://www.playorbit.in/loc/${slug}`) }) as unknown as NextRequest;
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /loc/[slug]', () => {
  it("redirects to the center's own mapUrl when configured", async () => {
    findUniqueMock.mockResolvedValue({ mapUrl: 'https://maps.example/top-play' });

    const res = await GET(req('top-play'), ctx('top-play'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://maps.example/top-play');
  });

  it('keeps the platform (ABCA) map fallback for the legacy default suffix', async () => {
    findUniqueMock.mockResolvedValue(null);

    const res = await GET(req('default'), ctx('default'));

    expect(res.headers.get('location')).toBe(LOCATION_URL);
  });

  it('keeps the platform map fallback for the abca slug itself', async () => {
    findUniqueMock.mockResolvedValue({ mapUrl: null });

    const res = await GET(req('abca'), ctx('abca'));

    expect(res.headers.get('location')).toBe(LOCATION_URL);
  });

  it('sends any other center without a mapUrl to /centers — never to the ABCA map', async () => {
    findUniqueMock.mockResolvedValue({ mapUrl: null });

    const res = await GET(req('top-play'), ctx('top-play'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.playorbit.in/centers');
  });

  it('sends an unknown slug to /centers', async () => {
    findUniqueMock.mockResolvedValue(null);

    const res = await GET(req('nope'), ctx('nope'));

    expect(res.headers.get('location')).toBe('https://www.playorbit.in/centers');
  });

  it('treats a non-http mapUrl as missing (no open redirect)', async () => {
    findUniqueMock.mockResolvedValue({ mapUrl: 'javascript:alert(1)' });

    const res = await GET(req('top-play'), ctx('top-play'));

    expect(res.headers.get('location')).toBe('https://www.playorbit.in/centers');
  });

  it('falls back instead of 500ing when the lookup fails', async () => {
    findUniqueMock.mockRejectedValue(new Error('db down'));

    const res = await GET(req('top-play'), ctx('top-play'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.playorbit.in/centers');
  });
});
