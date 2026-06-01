/**
 * inspect-center.mjs  <centerSlug>
 */
import { PrismaClient } from '@prisma/client';

const slug = process.argv[2];
if (!slug) { console.error('Usage: node scripts/inspect-center.mjs <centerSlug>'); process.exit(1); }

const prisma = new PrismaClient();

async function main() {
  const center = await prisma.center.findUnique({
    where: { slug },
    include: {
      resources: { orderBy: { name: 'asc' } },
      machines: {
        orderBy: { name: 'asc' },
        include: { resource: true, machineType: true },
      },
      memberships: {
        include: { user: { select: { id: true, name: true, email: true, mobileNumber: true } } },
        orderBy: [{ role: 'asc' }, { userId: 'asc' }],
      },
      centerPolicies: { orderBy: { key: 'asc' } },
    },
  });

  if (!center) { console.error(`Center not found: ${slug}`); process.exit(1); }

  console.log('='.repeat(70));
  console.log(`CENTER: ${center.name}  (id=${center.id}, slug=${center.slug})`);
  console.log(`bookingModel: ${center.bookingModel}`);
  console.log('='.repeat(70));

  console.log('\n── RESOURCES ──');
  if (!center.resources.length) { console.log('  (none)'); }
  else for (const r of center.resources) {
    console.log(`  [${r.id}]  type=${r.type}  name="${r.name}"  isActive=${r.isActive}`);
    if (r.description) console.log(`           desc: ${r.description}`);
  }

  console.log('\n── MACHINES ──');
  if (!center.machines.length) { console.log('  (none)'); }
  else for (const m of center.machines) {
    const netName = m.resource ? `"${m.resource.name}" (${m.resource.id})` : '(no net linked)';
    const mtName  = m.machineType ? m.machineType.name : '–';
    console.log(`  [${m.id}]  name="${m.name}"  type=${mtName}`);
    console.log(`           net→ ${netName}`);
    console.log(`           legacyId=${m.legacyMachineId ?? '–'}  isActive=${m.isActive}`);
    console.log(`           pitchTypes=${JSON.stringify(m.supportedPitchTypes)}`);
    console.log(`           ballTypes=${JSON.stringify(m.supportedBallTypes)}`);
  }

  console.log('\n── MEMBERSHIPS ──');
  const byRole = {};
  for (const m of center.memberships) { (byRole[m.role] ??= []).push(m); }
  if (!Object.keys(byRole).length) { console.log('  (none)'); }
  else for (const [role, members] of Object.entries(byRole)) {
    console.log(`  ${role}:`);
    for (const m of members) {
      const u = m.user;
      console.log(`    userId=${u.id}  name="${u.name ?? '–'}"  email=${u.email ?? '–'}  mobile=${u.mobileNumber ?? '–'}`);
    }
  }

  console.log('\n── CENTER POLICIES ──');
  if (!center.centerPolicies.length) { console.log('  (none)'); }
  else for (const p of center.centerPolicies) {
    let val = p.value;
    try { val = JSON.stringify(JSON.parse(p.value), null, 2).replace(/\n/g, '\n             '); } catch {}
    console.log(`  [${p.key}]\n             ${val}`);
  }

  console.log('\n' + '='.repeat(70));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
