/**
 * The one place the NextAuth signing secret is read.
 *
 * `src/app/page.tsx` used to read `NEXT_AUTH_SECRET || NEXTAUTH_SECRET` while
 * `src/middleware.ts` read only `NEXTAUTH_SECRET`. Two readers of the same
 * cookie disagreeing about the key is the same failure shape as the
 * jsonwebtoken-on-the-edge bug in `@/lib/jwt`: one of them says "signed in",
 * the other says "signed out", and the user ends up in a redirect loop
 * between `/` and `/slots` that no amount of retrying escapes.
 *
 * `NEXTAUTH_SECRET` is what `authOptions` signs with, so it wins; the
 * misspelled variant stays as a fallback for any environment still setting
 * only that one.
 *
 * Edge-safe: environment reads only, no Node built-ins.
 */
export const NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || process.env.NEXT_AUTH_SECRET;
