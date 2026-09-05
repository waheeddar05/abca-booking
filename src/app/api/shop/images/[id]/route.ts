import { NextRequest, NextResponse } from 'next/server';
import { imageResponse, loadProductImage } from '@/lib/marketplace-server';

type Params = { id: string };

/**
 * GET /api/shop/images/[id] — a product photo.
 *
 * Public and served with a year-long immutable cache: image rows are
 * never edited in place (replacing a photo deletes the row and uploads a
 * new one, i.e. a new id), so the id is a safe forever-cache key. Served
 * regardless of the product's published state — the admin editor shows
 * photos of unpublished products, and ids are unguessable cuids.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{10,40}$/i.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Revalidation from a browser that already holds it: nothing to send.
  if (req.headers.get('if-none-match') === `"${id}"`) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: `"${id}"`, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  }

  try {
    const row = await loadProductImage(id);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return imageResponse(row);
  } catch (error) {
    console.error('[api:shop.image]', error);
    return NextResponse.json({ error: 'Image unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
