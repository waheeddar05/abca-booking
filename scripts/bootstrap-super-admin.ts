/**
 * ONE-SHOT: promote a single account to super admin on the production database.
 *
 * Why this exists as a build step rather than the normal path: the normal path
 * is SUPER_ADMIN_MOBILE (see src/lib/auth.ts), and setting that requires access
 * to the Vercel project's environment variables. The build container is the one
 * place that already holds production DATABASE_URL without anybody having to
 * pull it onto a laptop.
 *
 * This is deliberately temporary. It is reverted in the commit immediately
 * after the deploy that runs it, and reverting is safe: the grant is written to
 * the User row, so removing this script cannot take it away.
 *
 * Safety properties, in order of how much they matter:
 *   - Production only. `VERCEL_ENV` is set by Vercel itself and is "preview" for
 *     the test branch, so this cannot touch the test database.
 *   - Exactly one row, matched on the full mobile number. Zero or several and it
 *     refuses rather than guessing.
 *   - Idempotent. Already-promoted is a no-op.
 *   - Upgrade only. It sets role and isSuperAdmin; it never clears anything.
 *   - Never fails the build. A bootstrap task must not be able to take the site
 *     down, so every failure path logs and exits 0.
 */

import { prisma } from '../src/lib/prisma';

/** Already public in this repo — see the comment in src/lib/auth.ts. */
const TARGET_MOBILE = '9860106704';

const TAG = '[bootstrap-super-admin]';

async function main() {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log(`${TAG} skipped — VERCEL_ENV=${process.env.VERCEL_ENV ?? '(unset)'}, not production`);
    return;
  }

  const matches = await prisma.user.findMany({
    where: { mobileNumber: TARGET_MOBILE },
    select: { id: true, name: true, mobileNumber: true, role: true, isSuperAdmin: true },
  });

  if (matches.length === 0) {
    console.warn(
      `${TAG} NO ACCOUNT for ${TARGET_MOBILE}. Accounts are created on first login — ` +
        'sign in once with that number, then redeploy.',
    );
    return;
  }
  if (matches.length > 1) {
    console.error(`${TAG} ${matches.length} accounts match ${TARGET_MOBILE} — refusing to guess.`);
    return;
  }

  const before = matches[0];
  console.log(`${TAG} before: role=${before.role} isSuperAdmin=${before.isSuperAdmin} id=${before.id}`);

  if (before.role === 'ADMIN' && before.isSuperAdmin) {
    console.log(`${TAG} already a super admin — nothing to do`);
    return;
  }

  const after = await prisma.user.update({
    where: { id: before.id },
    data: { role: 'ADMIN', isSuperAdmin: true },
    select: { id: true, name: true, mobileNumber: true, role: true, isSuperAdmin: true },
  });

  console.log(`${TAG} after:  role=${after.role} isSuperAdmin=${after.isSuperAdmin} id=${after.id}`);
  console.log(`${TAG} ✓ ${after.mobileNumber} is now a super admin`);
}

main()
  .catch((error) => {
    // Never break the deploy over this.
    console.error(`${TAG} failed (deploy continues):`, error instanceof Error ? error.message : error);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
