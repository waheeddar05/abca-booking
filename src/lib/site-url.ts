/**
 * The public origin of this deployment, for anything that must be an
 * absolute URL: Open Graph / Twitter share images, canonical links.
 *
 * One build serves several hostnames (www.playorbit.in, test.playorbit.in,
 * the *.vercel.app preview URLs), so the answer depends on where the build
 * is running. Resolution order:
 *
 *   1. `NEXT_PUBLIC_SITE_URL` — an explicit override, per Vercel environment.
 *   2. Vercel production → the canonical www domain.
 *   3. The `test` branch preview → its custom domain. The bare Vercel preview
 *      URL is behind deployment protection, so a share-preview crawler could
 *      not fetch an image from it.
 *   4. Any other preview → its Vercel URL.
 *   5. Local dev → localhost.
 *
 * Pure and synchronous: safe from `metadata` exports and static prerenders.
 */
export const PRODUCTION_ORIGIN = 'https://www.playorbit.in';

export function siteOrigin(): URL {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  if (explicit) {
    try {
      return new URL(explicit);
    } catch {
      // Malformed override — fall through to the environment rules.
    }
  }
  if (process.env.VERCEL_ENV === 'production') return new URL(PRODUCTION_ORIGIN);
  if (process.env.VERCEL_GIT_COMMIT_REF === 'test') return new URL('https://test.playorbit.in');
  if (process.env.VERCEL_URL) return new URL(`https://${process.env.VERCEL_URL}`);
  return new URL(`http://localhost:${process.env.PORT ?? '3000'}`);
}
