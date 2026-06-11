/**
 * Next.js instrumentation — runs once per server bootstrap (including
 * serverless cold starts) before any request is handled.
 *
 * Suppresses Node deprecation warnings (e.g. DEP0169 `url.parse` from
 * NextAuth v4) which otherwise show up as `error`-level noise in Vercel
 * runtime logs on every /api/auth/* invocation, drowning out real errors.
 * Equivalent to running node with --no-deprecation. Non-deprecation
 * warnings are unaffected.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.noDeprecation = true;
  }
}
