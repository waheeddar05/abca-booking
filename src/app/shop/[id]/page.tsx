import type { Metadata } from 'next';
import { ProductDetailClient } from '@/components/shop/ProductDetailClient';

export const metadata: Metadata = {
  title: 'PlayOrbit Shop',
};

/**
 * /shop/[id] — one product. Public: a link shared on WhatsApp must open
 * for whoever taps it, so the product is looked up by id alone and the
 * client decides what to offer (notify / order / sign in) from the API's
 * `signedIn` flag rather than from any session hook.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailClient id={id} />;
}
