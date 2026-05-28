
import { describe, it, expect } from 'vitest';
import { applyBlocksToAvailability, ActiveBlock } from '../resource-booking';
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

  it('Issue 1: Full-court block should not block Natural Turf', () => {
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

    // Indoor pool should be empty
    expect(result.availability.freeIndoorNets).toHaveLength(0);
    // ASTRO and CEMENT (indoor) should be empty
    expect(result.availability.freeByPitch.ASTRO).toHaveLength(0);
    expect(result.availability.freeByPitch.CEMENT).toHaveLength(0);
    
    // NATURAL turf should still be available
    expect(result.availability.freeByPitch.NATURAL).toHaveLength(1);
    expect(result.availability.freeByPitch.NATURAL[0].id).toBe('natural1');

    // Categorical blocking in blockedByPitch
    expect(result.blockedByPitch.ASTRO.categories.has('MACHINE')).toBe(true);
    expect(result.blockedByPitch.NATURAL.categories.has('MACHINE')).toBe(false);
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
});
