import { describe, it, expect } from 'vitest';
import {
  ballOptionsForMachineType,
  isBallTypeValidForMachineType,
  coerceBallTypeForMachineType,
  PACKAGE_BALL_OPTIONS,
  PACKAGE_BALL_TENNIS_OPTIONS,
} from '@/lib/package-admin-labels';

describe('ballOptionsForMachineType', () => {
  it('offers Machine / Leather for leather machines', () => {
    expect(ballOptionsForMachineType('LEATHER')).toEqual(PACKAGE_BALL_OPTIONS);
    expect(ballOptionsForMachineType('LEATHER').map(o => o.value)).toEqual(['LEATHER', 'MACHINE']);
  });

  it('offers Machine / Tennis for tennis machines', () => {
    expect(ballOptionsForMachineType('TENNIS')).toEqual(PACKAGE_BALL_TENNIS_OPTIONS);
    expect(ballOptionsForMachineType('TENNIS').map(o => o.value)).toEqual(['MACHINE', 'TENNIS']);
  });

  it('never offers Leather for tennis machines', () => {
    expect(ballOptionsForMachineType('TENNIS').some(o => o.value === 'LEATHER')).toBe(false);
  });

  it('never offers Tennis for leather machines', () => {
    expect(ballOptionsForMachineType('LEATHER').some(o => o.value === 'TENNIS')).toBe(false);
  });
});

describe('isBallTypeValidForMachineType', () => {
  it('accepts Machine / Leather / Both for leather machines', () => {
    expect(isBallTypeValidForMachineType('LEATHER', 'MACHINE')).toBe(true);
    expect(isBallTypeValidForMachineType('LEATHER', 'LEATHER')).toBe(true);
    expect(isBallTypeValidForMachineType('LEATHER', 'BOTH')).toBe(true);
  });

  it('rejects Tennis for leather machines', () => {
    expect(isBallTypeValidForMachineType('LEATHER', 'TENNIS')).toBe(false);
  });

  it('accepts Machine / Tennis for tennis machines', () => {
    expect(isBallTypeValidForMachineType('TENNIS', 'MACHINE')).toBe(true);
    expect(isBallTypeValidForMachineType('TENNIS', 'TENNIS')).toBe(true);
  });

  it('rejects Leather / Both for tennis machines', () => {
    expect(isBallTypeValidForMachineType('TENNIS', 'LEATHER')).toBe(false);
    expect(isBallTypeValidForMachineType('TENNIS', 'BOTH')).toBe(false);
  });

  it('treats a missing ball type as valid (optional column)', () => {
    expect(isBallTypeValidForMachineType('TENNIS', null)).toBe(true);
    expect(isBallTypeValidForMachineType('LEATHER', undefined)).toBe(true);
  });
});

describe('coerceBallTypeForMachineType', () => {
  it('keeps a valid current value', () => {
    expect(coerceBallTypeForMachineType('LEATHER', 'MACHINE')).toBe('MACHINE');
    expect(coerceBallTypeForMachineType('TENNIS', 'TENNIS')).toBe('TENNIS');
  });

  it('clears an incompatible value to the category default', () => {
    // Leather selected, switched to a tennis machine → drop to Tennis.
    expect(coerceBallTypeForMachineType('TENNIS', 'LEATHER')).toBe('TENNIS');
    // Tennis selected, switched to a leather machine → drop to Leather.
    expect(coerceBallTypeForMachineType('LEATHER', 'TENNIS')).toBe('LEATHER');
  });

  it('falls back to the category default when current is empty', () => {
    expect(coerceBallTypeForMachineType('LEATHER', null)).toBe('LEATHER');
    expect(coerceBallTypeForMachineType('TENNIS', '')).toBe('TENNIS');
  });
});
