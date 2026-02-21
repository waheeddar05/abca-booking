import { BallType, MachineId, PitchType } from '@prisma/client';

// ─── Machine Definitions ───

export interface MachineDefinition {
  id: MachineId;
  name: string;
  shortName: string;
  ballType: BallType; // The ball type this machine uses (auto-determined)
  category: 'LEATHER' | 'TENNIS'; // Machine category
  defaultPitchTypes: PitchType[]; // Pitch types enabled by default
  allPitchTypes: PitchType[]; // All pitch types that *can* be enabled
}

export const MACHINES: Record<MachineId, MachineDefinition> = {
  GRAVITY: {
    id: 'GRAVITY',
    name: 'Gravity (Leather)',
    shortName: 'Gravity',
    ballType: 'LEATHER',
    category: 'LEATHER',
    defaultPitchTypes: ['ASTRO'],
    allPitchTypes: ['ASTRO', 'CEMENT', 'NATURAL'],
  },
  YANTRA: {
    id: 'YANTRA',
    name: 'Yantra (Premium Leather)',
    shortName: 'Yantra',
    ballType: 'LEATHER',
    category: 'LEATHER',
    defaultPitchTypes: ['ASTRO'],
    allPitchTypes: ['ASTRO', 'CEMENT', 'NATURAL'],
  },
  LEVERAGE_INDOOR: {
    id: 'LEVERAGE_INDOOR',
    name: 'Leverage High Speed Tennis (Indoor)',
    shortName: 'Tennis Indoor',
    ballType: 'TENNIS',
    category: 'TENNIS',
    defaultPitchTypes: ['ASTRO', 'CEMENT'],
    allPitchTypes: ['ASTRO', 'CEMENT', 'NATURAL'],
  },
  LEVERAGE_OUTDOOR: {
    id: 'LEVERAGE_OUTDOOR',
    name: 'Leverage High Speed Tennis (Outdoor)',
    shortName: 'Tennis Outdoor',
    ballType: 'TENNIS',
    category: 'TENNIS',
    defaultPitchTypes: ['ASTRO', 'CEMENT'],
    allPitchTypes: ['ASTRO', 'CEMENT', 'NATURAL'],
  },
};

export const ALL_MACHINE_IDS: MachineId[] = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];

export const LEATHER_MACHINES: MachineId[] = ['GRAVITY', 'YANTRA'];
export const TENNIS_MACHINES: MachineId[] = ['LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];

// ─── Pitch Type Definitions ───

export interface PitchTypeDefinition {
  id: PitchType;
  name: string;
  shortName: string;
}

export const PITCH_TYPES: Record<string, PitchTypeDefinition> = {
  ASTRO: { id: 'ASTRO', name: 'Astro Turf', shortName: 'Astro' },
  CEMENT: { id: 'CEMENT', name: 'Cement', shortName: 'Cement' },
  NATURAL: { id: 'NATURAL', name: 'Natural Turf', shortName: 'Natural' },
};

export const ALL_PITCH_TYPES: PitchType[] = ['ASTRO', 'CEMENT', 'NATURAL'];

// ─── Ball Type Definitions ───

export const BALL_TYPES = {
  LEATHER: { id: 'LEATHER' as BallType, name: 'Leather Ball' },
  TENNIS: { id: 'TENNIS' as BallType, name: 'Tennis Ball' },
};

// ─── Machine ↔ Pitch Compatibility ───

/**
 * Default machine-pitch compatibility configuration.
 * Admin can override this via the MACHINE_PITCH_CONFIG policy key.
 * For each machine ID, stores which pitch types are enabled.
 */
export type MachinePitchConfig = Record<MachineId, PitchType[]>;

export const DEFAULT_MACHINE_PITCH_CONFIG: MachinePitchConfig = {
  GRAVITY: ['ASTRO', 'CEMENT', 'NATURAL'],
  YANTRA: ['ASTRO', 'CEMENT', 'NATURAL'],
  LEVERAGE_INDOOR: ['ASTRO', 'CEMENT', 'NATURAL'],
  LEVERAGE_OUTDOOR: ['ASTRO', 'CEMENT', 'NATURAL'],
};

// ─── Helpers ───

/**
 * Get the ball type for a given machine.
 */
export function getBallTypeForMachine(machineId: MachineId): BallType {
  return MACHINES[machineId].ballType;
}

/**
 * Get the machine category ('LEATHER' | 'TENNIS') for a given machine.
 */
export function getMachineCategory(machineId: MachineId): 'LEATHER' | 'TENNIS' {
  return MACHINES[machineId].category;
}

/**
 * Check if a machine ID is valid.
 */
export function isValidMachineId(val: string): val is MachineId {
  return ALL_MACHINE_IDS.includes(val as MachineId);
}

/**
 * Check if a pitch type is valid (excluding deprecated TURF).
 */
export function isValidPitchType(val: string): val is PitchType {
  return ALL_PITCH_TYPES.includes(val as PitchType);
}

/**
 * Get all machines in a given category.
 */
export function getMachinesByCategory(category: 'LEATHER' | 'TENNIS'): MachineId[] {
  return category === 'LEATHER' ? LEATHER_MACHINES : TENNIS_MACHINES;
}

// ─── Legacy Compatibility ───

/** @deprecated Use MACHINES and machineId instead */
export const MACHINE_A_BALLS: BallType[] = ['LEATHER', 'MACHINE'];
/** @deprecated Use MACHINES and machineId instead */
export const MACHINE_B_BALLS: BallType[] = ['TENNIS'];

/** @deprecated Use getBallTypeForMachine instead */
export function getRelevantBallTypes(ballType: BallType): BallType[] {
  if (MACHINE_A_BALLS.includes(ballType)) {
    return MACHINE_A_BALLS;
  }
  if (MACHINE_B_BALLS.includes(ballType)) {
    return MACHINE_B_BALLS;
  }
  return [];
}

/** @deprecated Use isValidMachineId instead */
export function isValidBallType(ballType: string): ballType is BallType {
  return [...MACHINE_A_BALLS, ...MACHINE_B_BALLS].includes(ballType as BallType);
}
