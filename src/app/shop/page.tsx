import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoadingState } from '@/components/ui/LoadingState';
import { ShopPageClient } from '@/components/shop/ShopPageClient';

export const metadata: Metadata = {
  title: 'PlayOrbit Shop - Cricket Gear',
  description: 'Bats, gloves, guards, pads and more from PlayOrbit.',
};

/**
 * /shop — the public storefront for the current center.
 *
 * Browsable signed-out (the middleware lets /shop and /api/shop through),
 * so this shell stays a static server component. The catalog, filters and
 * search live in `ShopPageClient`, which reads `?category=` / `?q=` via
 * `useSearchParams` and therefore needs a Suspense boundary so the page
 * can still prerender a fallback.
 */
export default function ShopPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading the shop…" />}>
      <ShopPageClient />
    </Suspense>
  );
}
