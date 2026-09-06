/**
 * ONE-SHOT: grant the Cricket Store admin flag to named accounts on the TEST
 * environment's database, from inside the Vercel build.
 *
 * Why a build step. The normal path is Admin → Users → "Make Store Admin"
 * (super admin only) or `scripts/make-admin.ts <mobile> --store`, and both
 * need either a signed-in super admin or the database URL. Neither is at
 * hand here — there is no Vercel credential and no database URL outside the
 * build container — while the build already holds DATABASE_URL for
 * `prisma migrate deploy`. Same approach as the earlier super-admin
 * bootstrap (b8a7a83), and like it this is temporary: it is reverted in the
 * commit right after the deploy that runs it, which is safe because the grant
 * is written to the User rows and removing the script cannot take it away.
 *
 * Safety properties, in order of how much they matter:
 *   - Test branch only. Vercel sets VERCEL_GIT_COMMIT_REF to the branch being
 *     built; anything other than `test` (main, a preview branch, a local
 *     build with no Vercel env) skips without a query. Keying on the branch
 *     rather than VERCEL_ENV means it behaves the same whether test is a
 *     preview of the main project or a project of its own.
 *   - Runs after `prisma migrate deploy`, so User.isStoreAdmin exists.
 *   - Matched on the exact 10-digit mobile number; zero or several rows and
 *     it refuses to guess and says which.
 *   - Idempotent — already granted is a no-op, so a retried build is harmless.
 *   - Upgrade only. Sets isStoreAdmin; never touches role or anything else.
 *   - Never fails the build. Every path logs and exits 0.
 *
 * It logs each row before and after, so the build log is the verification
 * record rather than a claim.
 */

import { prisma } from '../src/lib/prisma';

const TARGET_BRANCH = 'test';
/** 9860106704 is already public in this repo (src/lib/auth.ts). */
const TARGET_MOBILES = ['9860106704', '7774077995'] as const;

const TAG = '[bootstrap-store-admins]';

async function grant(mobile: string): Promise<void> {
  const matches = await prisma.user.findMany({
    where: { mobileNumber: mobile },
    select: { id: true, name: true, mobileNumber: true, role: true, isSuperAdmin: true, isStoreAdmin: true },
  });

  if (matches.length === 0) {
    console.warn(
      `${TAG} ${mobile}: NO ACCOUNT. Accounts are created on first login — sign in once with that number on test, then redeploy.`,
    );
    return;
  }
  if (matches.length > 1) {
    console.error(`${TAG} ${mobile}: ${matches.length} accounts match — refusing to guess.`);
    return;
  }

  const before = matches[0];
  console.log(
    `${TAG} ${mobile}: before role=${before.role} isSuperAdmin=${before.isSuperAdmin} isStoreAdmin=${before.isStoreAdmin} id=${before.id}`,
  );

  if (before.isStoreAdmin) {
    console.log(`${TAG} ${mobile}: already a store admin — nothing to do`);
    return;
  }

  const after = await prisma.user.update({
    where: { id: before.id },
    data: { isStoreAdmin: true },
    select: { role: true, isSuperAdmin: true, isStoreAdmin: true },
  });
  console.log(
    `${TAG} ${mobile}: after  role=${after.role} isSuperAdmin=${after.isSuperAdmin} isStoreAdmin=${after.isStoreAdmin} ✓`,
  );
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (branch !== TARGET_BRANCH) {
    console.log(`${TAG} skipped — VERCEL_GIT_COMMIT_REF=${branch ?? '(unset)'}, not "${TARGET_BRANCH}"`);
    return;
  }
  for (const mobile of TARGET_MOBILES) {
    await grant(mobile);
  }
  console.log(`${TAG} done. The grant takes effect at each account's next WhatsApp login.`);
}

main()
  .catch((error) => {
    // A bootstrap task must never be able to take the site down.
    console.error(`${TAG} failed (build continues):`, error);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
