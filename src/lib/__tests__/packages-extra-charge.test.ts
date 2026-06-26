import { describe, it, expect, vi } from 'vitest';

// packages.ts imports the Prisma client at module load. The pure
// extra-charge helpers under test never touch the DB, so a stub is enough
// to keep the import from initialising a real client in the test env.
vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

import {
  getMachineExtraCharge,
  calculatePackageExtraCharge,
  type ExtraChargeRules,
} from '../packages';

describe('getMachineExtraCharge', () => {
  const rules: ExtraChargeRules = {
    machineUpgrades: {
      YANTRA_TO_GRAVITY: 100,
      GRAVITY_TO_YANTRA: 150,
    },
  };

  it('returns 0 when booking the same machine the package is for', () => {
    expect(getMachineExtraCharge('YANTRA', 'YANTRA', rules)).toBe(0);
  });

  it('charges the configured per-direction price (Yantra → Gravity)', () => {
    expect(getMachineExtraCharge('YANTRA', 'GRAVITY', rules)).toBe(100);
  });

  it('charges a different price for the reverse direction (Gravity → Yantra)', () => {
    expect(getMachineExtraCharge('GRAVITY', 'YANTRA', rules)).toBe(150);
  });

  it('returns 0 for a cross-machine booking with no rule configured', () => {
    expect(getMachineExtraCharge('GRAVITY', 'LEVERAGE_INDOOR', rules)).toBe(0);
  });

  it('returns 0 when either machine id is missing', () => {
    expect(getMachineExtraCharge(null, 'GRAVITY', rules)).toBe(0);
    expect(getMachineExtraCharge('GRAVITY', null, rules)).toBe(0);
  });

  it('ignores non-positive configured prices', () => {
    expect(
      getMachineExtraCharge('YANTRA', 'GRAVITY', { machineUpgrades: { YANTRA_TO_GRAVITY: 0 } }),
    ).toBe(0);
  });
});

describe('calculatePackageExtraCharge — machine surcharge', () => {
  it('includes the machine surcharge in the total and breakdown', () => {
    const result = calculatePackageExtraCharge(
      {
        machineId: 'YANTRA',
        machineType: 'LEATHER',
        ballType: 'LEATHER',
        wicketType: 'BOTH',
        timingType: 'BOTH',
        extraChargeRules: { machineUpgrades: { YANTRA_TO_GRAVITY: 100 } },
      },
      {
        machineId: 'GRAVITY',
        ballType: 'LEATHER',
        pitchType: 'ASTRO',
        slotTimeSlab: 'morning',
      },
    );

    expect(result.breakdown.machineExtra).toBe(100);
    expect(result.totalExtra).toBe(100);
  });

  it('stacks the machine surcharge on top of a timing upgrade', () => {
    const result = calculatePackageExtraCharge(
      {
        machineId: 'YANTRA',
        machineType: 'LEATHER',
        ballType: 'LEATHER',
        wicketType: 'BOTH',
        timingType: 'DAY',
        extraChargeRules: { machineUpgrades: { YANTRA_TO_GRAVITY: 100 }, timingUpgrade: 125 },
      },
      {
        machineId: 'GRAVITY',
        ballType: 'LEATHER',
        pitchType: 'ASTRO',
        slotTimeSlab: 'evening',
      },
    );

    expect(result.breakdown.machineExtra).toBe(100);
    expect(result.breakdown.timingExtra).toBe(125);
    expect(result.totalExtra).toBe(225);
  });

  it('charges nothing when the same machine is booked', () => {
    const result = calculatePackageExtraCharge(
      {
        machineId: 'YANTRA',
        machineType: 'LEATHER',
        ballType: 'LEATHER',
        wicketType: 'BOTH',
        timingType: 'BOTH',
        extraChargeRules: { machineUpgrades: { YANTRA_TO_GRAVITY: 100 } },
      },
      {
        machineId: 'YANTRA',
        ballType: 'LEATHER',
        pitchType: 'ASTRO',
        slotTimeSlab: 'morning',
      },
    );

    expect(result.totalExtra).toBe(0);
  });
});
