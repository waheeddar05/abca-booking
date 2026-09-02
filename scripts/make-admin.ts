/**
 * Grant admin rights to an account.
 *
 *   npx tsx scripts/make-admin.ts <email|mobile> [--super] [--center <slug>]
 *
 * Three grants are separate in this codebase and you usually need more
 * than one — that is the whole reason this script exists:
 *
 *   User.role = 'ADMIN'            gets you past the middleware into /admin
 *   User.isSuperAdmin = true       cross-center pages (Centers, Orphan
 *                                  Payments, Maintenance, DB Cleanup) and
 *                                  a bypass of every center scope check
 *   CenterMembership(ADMIN)        center-scoped WRITES — without it you
 *                                  can open Configuration but not save it
 *                                  (POST /api/admin/policies checks it)
 *
 * Login is WhatsApp OTP, so accounts have a mobile number and often NO
 * email at all. Every other bootstrap path in the repo is email-keyed —
 * the SUPER_ADMIN_EMAIL fallback in src/lib/auth.ts and the promotion in
 * scripts/seed-centers.ts both match on `email` and silently do nothing
 * for a phone-only account. This script is the mobile-first way in.
 *
 * Examples:
 *   npx tsx scripts/make-admin.ts 9876543210 --super
 *   npx tsx scripts/make-admin.ts 9876543210 --center toplay
 *   npx tsx scripts/make-admin.ts admin@example.com --super --center abca
 */

import { prisma } from '../src/lib/prisma';

/** Same normalization the login uses, so +91XXXXXXXXXX finds the row. */
function normalizeMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function usage(): never {
  console.error('Usage: npx tsx scripts/make-admin.ts <email|mobile> [--super] [--center <slug|id>]');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const identifier = args.find((a) => !a.startsWith('--'));
  const wantSuper = args.includes('--super');
  const centerFlag = args.indexOf('--center');
  const centerKey = centerFlag >= 0 ? args[centerFlag + 1] : undefined;

  if (!identifier) usage();
  if (centerFlag >= 0 && (!centerKey || centerKey.startsWith('--'))) {
    console.error('--center needs a center slug or id, e.g. --center toplay');
    process.exit(1);
  }

  const asMobile = normalizeMobile(identifier);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { mobileNumber: identifier },
        // Accept +91 / spaced input for the same row.
        ...(asMobile && asMobile !== identifier ? [{ mobileNumber: asMobile }] : []),
      ],
    },
    select: { id: true, email: true, mobileNumber: true, role: true, isSuperAdmin: true },
  });

  if (!user) {
    console.error(`No account found for "${identifier}".`);
    console.error('The account is created on first login — sign in once with that number, then re-run this.');
    process.exit(1);
  }

  // ─── Resolve the center first, so a typo fails before anything is written ──
  let center: { id: string; name: string; slug: string } | null = null;
  if (centerKey) {
    center = await prisma.center.findFirst({
      where: { OR: [{ slug: centerKey }, { id: centerKey }] },
      select: { id: true, name: true, slug: true },
    });
    if (!center) {
      const all = await prisma.center.findMany({ select: { slug: true, name: true } });
      console.error(`No center matching "${centerKey}".`);
      console.error('Available:', all.map((c) => `${c.slug} (${c.name})`).join(', ') || '(none)');
      process.exit(1);
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'ADMIN',
      // Never demote: omit the field entirely unless --super was passed.
      ...(wantSuper ? { isSuperAdmin: true } : {}),
    },
    select: { id: true, email: true, mobileNumber: true, role: true, isSuperAdmin: true },
  });

  const label = updated.mobileNumber || updated.email || updated.id;
  console.log(`✓ ${label} → role=ADMIN${updated.isSuperAdmin ? ', isSuperAdmin=true' : ''}`);

  if (center) {
    await prisma.centerMembership.upsert({
      where: { userId_centerId_role: { userId: user.id, centerId: center.id, role: 'ADMIN' } },
      update: { isActive: true },
      create: { userId: user.id, centerId: center.id, role: 'ADMIN', isActive: true },
    });
    console.log(`✓ ${label} → ADMIN membership at ${center.name} (${center.slug})`);
  }

  // Say plainly what is still missing, rather than leaving them to discover
  // it as a 403 when they press Save.
  if (!updated.isSuperAdmin && !center) {
    console.warn(
      '\n⚠ No center membership granted. This account can open /admin but center-scoped\n' +
        '  writes (Configuration, Offers, staff management) will 403.\n' +
        '  Re-run with --center <slug>, or --super to bypass center scoping entirely.',
    );
  }
}

main()
  .catch((error) => {
    console.error('Error promoting user:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
