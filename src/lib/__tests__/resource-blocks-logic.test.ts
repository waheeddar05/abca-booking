
import { describe, it, expect } from 'vitest';
import { applyBlocksToAvailability, evaluateBlockForBooking, ActiveBlock } from '../resource-booking';
import { BookingCategory } from '@prisma/client';

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

  it('Issue 2: Partial Net blocking (netCount) should work and reflect in pitch lists', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Maintenance',
        appliesTo: 'ALL',
        categories: ['NET'],
        machineRowIds: [],
        resourceIds: [],
        pitchType: null,
        netCount: 2, // Block 2 out of 4 nets
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // Should have 2 nets left in freeIndoorNets (it slices from end)
    expect(result.availability.freeIndoorNets).toHaveLength(2);
    expect(result.availability.freeIndoorNets.map(r => r.id)).toEqual(['net1', 'net2']);

    // ASTRO and CEMENT should also be shrunk
    expect(result.availability.freeByPitch.ASTRO).toHaveLength(2);
    expect(result.availability.freeByPitch.ASTRO.map(r => r.id)).toEqual(['net1', 'net2']);

    // NATURAL turf unaffected
    expect(result.availability.freeByPitch.NATURAL).toHaveLength(1);

    // Full court should be unavailable whenever any net is blocked
    expect(result.availability.fullCourtAvailable).toBe(false);

    // Bug fix: a PARTIAL net block must NOT take the whole Cricket Nets
    // category off the board. If NET landed in the categorical blocked
    // sets, the slot grid greys out every net (the "block 2, lose all 4"
    // bug). Only the pool is reduced — the category stays bookable.
    expect(result.blockedCategories.has('NET')).toBe(false);
    expect(result.blockedByPitch.ASTRO.categories.has('NET')).toBe(false);
    expect(result.blockedByPitch.NATURAL.categories.has('NET')).toBe(false);
  });

  it('Issue 1b: full (no-count) Net block DOES block the whole category', () => {
    const blocks: ActiveBlock[] = [
      {
        id: 'block1',
        reason: 'Maintenance',
        appliesTo: 'ALL',
        categories: ['NET'],
        machineRowIds: [],
        resourceIds: [],
        pitchType: null,
        netCount: null, // null = block ALL nets (legacy behaviour)
        legacyMachineId: null,
        legacyMachineIds: [],
        legacyMachineType: null,
        legacyPitchType: null,
      },
    ];

    const result = applyBlocksToAvailability(initialAvailability, blocks);

    // No netCount => whole pool gone AND the category is blocked.
    expect(result.availability.freeIndoorNets).toHaveLength(0);
    expect(result.blockedByPitch.ASTRO.categories.has('NET')).toBe(true);
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
