
import { describe, it, expect } from 'vitest';
import {
  applyBlocksToAvailability,
  applyPitchReservations,
  computeSlotAvailability,
  evaluateBlockForBooking,
  ActiveBlock,
} from '../resource-booking';
import { BookingCategory } from '@prisma/client';

// Minimal occupancy snapshot with an empty load map.
const emptyOccupancy = () => ({
  resourceLoad: new Map<string, number>(),
  claimedResourceIds: new Set<string>(),
  busyCoachIds: new Set<string>(),
  busyStaffIds: new Set<string>(),
  busyMachineIds: new Set<string>(),
  hasFullCourtBooking: false,
});

// A block with all axes empty except the ones passed in.
const makeBlock = (over: Partial<ActiveBlock>): ActiveBlock => ({
  id: 'b', reason: null, appliesTo: 'ALL',
  machineRowIds: [], resourceIds: [], categories: [],
  pitchType: null, netCount: null,
  legacyMachineId: null, legacyMachineIds: [], legacyMachineType: null, legacyPitchType: null,
  ...over,
});

describe('applyBlocksToAvailability', () => {
  const mockResources = [
    { id: 'net1', name: 'Net 1', type: 'NET', category: 'INDOOR', displayOrder: 1 },
    { id: 'net2', name: 'Net 2', type: 'NET', category: 'INDOOR', displayOrder: 2 },
    { id: 'net3', name: 'Net 3', type: 'NET', category: 'INDOOR', displayOrder: 3 },
    { id: 'net4', name: 'Net 4', type: 'NET', category: 'INDOOR', displayOrder: 4 },
    { id: 'natural1', name: 'Natural 1', type: 'TURF_WICKET', category: 'OUTDOOR', displayOrder: 5 },
  ] as any[];

  const initialAvailability = {
    freeIndoorNets: [mockResources[0], mockResources[1], mockResources[2], mockResources[3]],
    freeOutdoorResources: [mockResources[4]],
    freeByPitch: {
      ASTRO: [mockResources[0], mockResources[1], mockResources[2], mockResources[3]],
      CEMENT: [mockResources[0], mockResources[1]],
      NATURAL: [mockResources[4]],
    },
    freeCoaches: [],
    freeSidearmStaff: [],
    fullCourtAvailable: true,
    corporateBatchNetsHeld: 0,
    reservedByPitch: { ASTRO: 0, CEMENT: 0, NATURAL: 0 },
  };

  it('Issue 1: Full-court block is independent — blocks ONLY full court', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Full Court Event',
        appliesTo: 'ALL',
        categories: ['FULL_COURT'],
        machineRowIds: [],
        resourceIds: [],
        pitchType: null,
        netCount: null,
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // Individual net pools are UNTOUCHED — a full-court block no longer
    // cascades to the individual Cricket Net / Machine / Sidearm bookings.
    expect(result.availability.freeIndoorNets).toHaveLength(4);
    expect(result.availability.freeByPitch.ASTRO).toHaveLength(4);
    expect(result.availability.freeByPitch.NATURAL).toHaveLength(1);

    // Only the Full Indoor Court option is taken off the board.
    expect(result.availability.fullCourtAvailable).toBe(false);
    expect(result.blockedCategories.has('FULL_COURT')).toBe(true);
    expect(result.blockedByPitch.ASTRO.categories.has('MACHINE')).toBe(false);
    expect(result.blockedByPitch.ASTRO.categories.has('NET')).toBe(false);

    // Booking-level: a Machine / Net booking is fine, full court is not.
    expect(
      evaluateBlockForBooking(blocks, { category: 'MACHINE', resourceIds: [], pitchType: 'ASTRO' }),
    ).toBeNull();
    expect(
      evaluateBlockForBooking(blocks, { category: 'NET', resourceIds: [], pitchType: 'ASTRO' }),
    ).toBeNull();
    expect(
      evaluateBlockForBooking(blocks, { category: 'FULL_COURT', resourceIds: [] }),
    ).not.toBeNull();
  });

  it('Issue 1c: pitch-only block scopes to that pitch (all categories)', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Astro resurfacing',
        appliesTo: 'ALL',
        categories: [],
        machineRowIds: [],
        resourceIds: [],
        pitchType: 'ASTRO',
        netCount: null,
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // Every category on ASTRO is greyed out; NATURAL is untouched.
    expect(result.blockedByPitch.ASTRO.categories.has('MACHINE')).toBe(true);
    expect(result.blockedByPitch.ASTRO.categories.has('NET')).toBe(true);
    expect(result.blockedByPitch.NATURAL.categories.has('MACHINE')).toBe(false);

    // Booking-level: any booking on ASTRO blocked, NATURAL allowed.
    expect(
      evaluateBlockForBooking(blocks, { category: 'NET', resourceIds: [], pitchType: 'ASTRO' }),
    ).not.toBeNull();
    expect(
      evaluateBlockForBooking(blocks, { category: 'NET', resourceIds: [], pitchType: 'NATURAL' }),
    ).toBeNull();
  });

  it('Issue 2: count block reserves N units of a pitch (capacity-aware)', () => {
    // One Astro Turf resource with capacity 4 (= "4 astro turfs").
    const resources = [
      { id: 'astro', name: 'Astro Turf', type: 'NET', category: 'INDOOR', capacity: 4, displayOrder: 1 },
      { id: 'natural', name: 'Natural Turf', type: 'TURF_WICKET', category: 'OUTDOOR', capacity: 2, displayOrder: 2 },
    ] as any[];

    // Block 3 of the 4 Astro units.
    const block = makeBlock({ pitchType: 'ASTRO', netCount: 3 });
    const occ = emptyOccupancy();
    applyPitchReservations(occ.resourceLoad, resources, [block], 'ALL');
    // 3 units held as virtual load on the cap-4 resource.
    expect(occ.resourceLoad.get('astro')).toBe(3);

    const avail = computeSlotAvailability({ resources, coaches: [], staff: [], occupancy: occ, batchNets: 0 });
    // 1 unit still bookable on Astro; Natural untouched; full court gone.
    expect(avail.freeByPitch.ASTRO).toHaveLength(1);
    expect(avail.freeByPitch.NATURAL).toHaveLength(1);
    expect(avail.fullCourtAvailable).toBe(false);

    // Blocking ALL 4 empties the pool.
    const occAll = emptyOccupancy();
    applyPitchReservations(occAll.resourceLoad, resources, [makeBlock({ pitchType: 'ASTRO', netCount: 4 })], 'ALL');
    const availAll = computeSlotAvailability({ resources, coaches: [], staff: [], occupancy: occAll, batchNets: 0 });
    expect(availAll.freeByPitch.ASTRO).toHaveLength(0);

    // A count block is NOT a hard block: bookings are gated by pool
    // capacity, not bounced outright by evaluateBlockForBooking.
    expect(
      evaluateBlockForBooking([block], { category: 'NET', resourceIds: [], pitchType: 'ASTRO' }),
    ).toBeNull();
  });

  it('Issue 2b: count block on a 4-net pool reserves whole resources', () => {
    // Four separate cap-1 nets — reserving 2 leaves exactly 2 bookable.
    const resources = [
      { id: 'net1', name: 'Net 1', type: 'NET', category: 'INDOOR', capacity: 1, displayOrder: 1 },
      { id: 'net2', name: 'Net 2', type: 'NET', category: 'INDOOR', capacity: 1, displayOrder: 2 },
      { id: 'net3', name: 'Net 3', type: 'NET', category: 'INDOOR', capacity: 1, displayOrder: 3 },
      { id: 'net4', name: 'Net 4', type: 'NET', category: 'INDOOR', capacity: 1, displayOrder: 4 },
    ] as any[];
    const occ = emptyOccupancy();
    applyPitchReservations(occ.resourceLoad, resources, [makeBlock({ pitchType: 'ASTRO', netCount: 2 })], 'ALL');
    const avail = computeSlotAvailability({ resources, coaches: [], staff: [], occupancy: occ, batchNets: 0 });
    expect(avail.freeByPitch.ASTRO).toHaveLength(2);
  });

  it('Issue 1b: a NET category block is independent — blocks only NET', () => {
    // A Cricket Nets category block (no count) blocks NET bookings only;
    // the shared pool stays open for Machine / Sidearm bookings.
    const blocks: ActiveBlock[] = [makeBlock({ categories: ['NET'] })];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // Pool is untouched (machine/sidearm can still consume nets)...
    expect(result.availability.freeIndoorNets).toHaveLength(4);
    // ...but the NET category itself is blocked.
    expect(result.blockedByPitch.ASTRO.categories.has('NET')).toBe(true);
    expect(result.blockedByPitch.ASTRO.categories.has('MACHINE')).toBe(false);
  });

  it('Issue 3b: machine+pitch block bites ONLY the matching pitch', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Yantra reserved for Natural',
        appliesTo: 'ALL',
        categories: ['MACHINE'],
        machineRowIds: ['m_yantra'],
        resourceIds: [],
        pitchType: 'NATURAL',
        netCount: null,
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    // Yantra MACHINE booking on NATURAL → blocked (exact combination).
    expect(
      evaluateBlockForBooking(blocks, {
        category: 'MACHINE',
        machineRowId: 'm_yantra',
        resourceIds: [],
        pitchType: 'NATURAL',
      }),
    ).not.toBeNull();

    // Same machine on ASTRO → NOT blocked (different pitch).
    expect(
      evaluateBlockForBooking(blocks, {
        category: 'MACHINE',
        machineRowId: 'm_yantra',
        resourceIds: [],
        pitchType: 'ASTRO',
      }),
    ).toBeNull();

    // A different machine on NATURAL → NOT blocked (different machine).
    expect(
      evaluateBlockForBooking(blocks, {
        category: 'MACHINE',
        machineRowId: 'm_master200',
        resourceIds: [],
        pitchType: 'NATURAL',
      }),
    ).toBeNull();
  });

  it('Issue 3: Machine+Pitch specific blocking', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Yantra reserved for Natural',
        appliesTo: 'ALL',
        categories: ['MACHINE'],
        machineRowIds: ['m_yantra'],
        resourceIds: [],
        pitchType: 'NATURAL',
        netCount: null,
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // Global blockedMachineRowIds still contains it for legacy
    expect(result.blockedMachineRowIds.has('m_yantra')).toBe(true);

    // Pitch-scoped check
    expect(result.blockedByPitch.NATURAL.machineRowIds.has('m_yantra')).toBe(true);
    expect(result.blockedByPitch.ASTRO.machineRowIds.has('m_yantra')).toBe(false);
  });

  it('Issue 3c: machine+category+pitch block does NOT grey out the whole category', () => {
    // Real-world report: a block for "Bowling Machine + Yantra + Astro"
    // should block Yantra on Astro only. Every other machine — and every
    // other category — on Astro must stay independently bookable. The bug
    // was that ticking the MACHINE category alongside the Yantra pin
    // greyed out the entire Astro tab.
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Yantra maintenance on Astro',
        appliesTo: 'ALL',
        categories: ['MACHINE'],
        machineRowIds: ['m_yantra'],
        resourceIds: [],
        pitchType: 'ASTRO',
        netCount: null,
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // The specific machine is blocked on Astro...
    expect(result.blockedByPitch.ASTRO.machineRowIds.has('m_yantra')).toBe(true);
    // ...but the MACHINE category is NOT blanket-blocked (other machines
    // and other categories on Astro remain available).
    expect(result.blockedByPitch.ASTRO.categories.has('MACHINE')).toBe(false);
    expect(result.blockedCategories.has('MACHINE')).toBe(false);

    // The net pools are untouched — nothing about a single-machine block
    // should consume indoor/outdoor net capacity.
    expect(result.availability.freeIndoorNets).toHaveLength(4);
    expect(result.availability.freeByPitch.ASTRO).toHaveLength(4);
    expect(result.availability.fullCourtAvailable).toBe(true);

    // Booking another machine on Astro is allowed; Yantra on Astro is not.
    expect(
      evaluateBlockForBooking(blocks, {
        category: 'MACHINE', machineRowId: 'm_gravity', resourceIds: [], pitchType: 'ASTRO',
      }),
    ).toBeNull();
    expect(
      evaluateBlockForBooking(blocks, {
        category: 'MACHINE', machineRowId: 'm_yantra', resourceIds: [], pitchType: 'ASTRO',
      }),
    ).not.toBeNull();
  });
});
