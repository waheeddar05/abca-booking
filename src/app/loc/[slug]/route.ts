import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LOCATION_URL } from '@/lib/client-constants';

/**
 * GET /loc/[slug] — per-center location redirect.
 *
 * Why this exists: WhatsApp "View Location" call-to-action buttons on a
 * message template can only carry a DYNAMIC URL SUFFIX appended to a fixed
 * base URL (Meta restriction — the variable must sit at the very end of the
 * URL). Per-center Google Maps links share no common prefix, so they can't go
 * on the button directly. Instead the approved booking template's button is
 *
 *     https://www.playorbit.in/loc/{{1}}
 *
 * and the notification code supplies the booking's center SLUG as the suffix
 * ({{1}}). This handler turns that slug into the center's own `mapUrl` with a
 * 307 redirect, so every center's confirmation message opens its real
 * location in one tap. Unknown slug / missing mapUrl falls back to the
 * platform-wide LOCATION_URL so the button is never dead.
 *
 * Public + maintenance-allowed (see src/middleware.ts) — a customer tapping a
 * map link must not be gated behind auth or a maintenance screen.
 */

export const dynamic = 'force-dynamic';

/** Only ever redirect to an http(s) URL — guards against a malformed or
 *  unexpected mapUrl turning into an open redirect to another scheme. */
function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  let target = LOCATION_URL;
  try {
    const center = await prisma.center.findUnique({
      where: { slug },
      select: { mapUrl: true },
    });
    const mapUrl = safeHttpUrl(center?.mapUrl);
    if (mapUrl) target = mapUrl;
  } catch (err) {
    // Never 500 a tapped map link — fall back to the platform location.
    console.error('[loc] center lookup failed:', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.redirect(target, 307);
}
