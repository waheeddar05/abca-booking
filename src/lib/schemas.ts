/**
 * Zod validation schemas for API request/response payloads.
 * Centralizes all validation logic and derives TypeScript types.
 */
import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────
export const MachineIdSchema = z.enum(['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR']);
export const BallTypeSchema = z.enum(['TENNIS', 'LEATHER', 'MACHINE']);
export const PitchTypeSchema = z.enum(['ASTRO', 'TURF', 'CEMENT', 'NATURAL']);
export const BookingStatusSchema = z.enum(['BOOKED', 'CANCELLED', 'DONE']);
export const OperationModeSchema = z.enum(['WITH_OPERATOR', 'SELF_OPERATE']);
export const MachineCategorySchema = z.enum(['LEATHER', 'TENNIS']);
export const TimeSlabSchema = z.enum(['morning', 'evening']);

// ─── Slot Types ──────────────────────────────────────────
export const SlotSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  status: z.string(),
  price: z.number().optional(),
  timeSlab: TimeSlabSchema.optional(),
  operatorAvailable: z.boolean().optional(),
});

export const AvailableSlotSchema = SlotSchema.extend({
  status: z.enum(['Available', 'Booked', 'OperatorUnavailable', 'Blocked']),
});

// ─── Booking Request ─────────────────────────────────────
export const BookSlotRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string(),
  endTime: z.string(),
  ballType: BallTypeSchema,
  machineId: MachineIdSchema,
  operationMode: OperationModeSchema,
  userPackageId: z.string().optional(),
  userId: z.string().optional(),
  playerName: z.string().optional(),
  pitchType: PitchTypeSchema.optional(),
});

export const BookSlotsRequestSchema = z.array(BookSlotRequestSchema).min(1).max(10);

// ─── Package Validation Request ──────────────────────────
export const PackageValidationRequestSchema = z.object({
  userPackageId: z.string(),
  ballType: BallTypeSchema,
  pitchType: PitchTypeSchema.nullable().optional(),
  startTime: z.string(),
  numberOfSlots: z.number().int().positive(),
  userId: z.string().optional(),
});

// ─── Booking Response ────────────────────────────────────
export const BookingSchema = z.object({
  id: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  status: BookingStatusSchema,
  playerName: z.string(),
  ballType: z.string(),
  pitchType: z.string().nullable(),
  price: z.number().nullable(),
  originalPrice: z.number().nullable(),
  discountAmount: z.number().nullable(),
  extraCharge: z.number().nullable(),
  operationMode: OperationModeSchema,
  machineId: MachineIdSchema.nullable().optional(),
});

// ─── Package Validation Response ─────────────────────────
export const PackageValidationResponseSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
  extraCharge: z.number().optional(),
  extraChargeType: z.string().nullable().optional(),
});

// ─── Machine Config ──────────────────────────────────────
export const MachineInfoSchema = z.object({
  id: MachineIdSchema,
  name: z.string(),
  shortName: z.string(),
  ballType: z.string(),
  category: MachineCategorySchema,
  enabledPitchTypes: z.array(z.string()),
});

export const SlabPricingSchema = z.object({
  single: z.number(),
  consecutive: z.number(),
});

export const PitchPricingSchema = z.object({
  ASTRO: z.object({ morning: SlabPricingSchema, evening: SlabPricingSchema }),
  CEMENT: z.object({ morning: SlabPricingSchema, evening: SlabPricingSchema }),
  NATURAL: z.object({ morning: SlabPricingSchema, evening: SlabPricingSchema }),
});

export const PricingConfigSchema = z.object({
  leather: PitchPricingSchema,
  yantra: PitchPricingSchema,
  machine: PitchPricingSchema,
  yantra_machine: PitchPricingSchema,
  tennis: PitchPricingSchema,
});

export const TimeSlabConfigSchema = z.object({
  morning: z.object({ start: z.string(), end: z.string() }),
  evening: z.object({ start: z.string(), end: z.string() }),
});

export const MachineConfigSchema = z.object({
  machines: z.array(MachineInfoSchema).optional(),
  leatherMachine: z.object({
    ballTypeSelectionEnabled: z.boolean(),
    leatherBallExtraCharge: z.number(),
    machineBallExtraCharge: z.number(),
    pitchTypeSelectionEnabled: z.boolean(),
  }),
  tennisMachine: z.object({
    pitchTypeSelectionEnabled: z.boolean(),
    astroPitchPrice: z.number(),
    turfPitchPrice: z.number(),
  }),
  defaultSlotPrice: z.number(),
  numberOfOperators: z.number(),
  pricingConfig: PricingConfigSchema,
  timeSlabConfig: TimeSlabConfigSchema,
});

// ─── API Error Response ──────────────────────────────────
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

// ─── Cancellation Request ────────────────────────────────
export const CancelBookingRequestSchema = z.object({
  bookingId: z.string(),
  reason: z.string().optional(),
});

// ─── User Package ────────────────────────────────────────
export const UserPackageSchema = z.object({
  id: z.string(),
  packageName: z.string(),
  machineType: z.string(),
  ballType: z.string().nullable().optional(),
  wicketType: z.string().nullable().optional(),
  timingType: z.string(),
  totalSessions: z.number(),
  usedSessions: z.number(),
  remainingSessions: z.number(),
  activationDate: z.string(),
  expiryDate: z.string(),
  status: z.string(),
  amountPaid: z.number(),
});

// ─── Derived Types ───────────────────────────────────────
export type MachineId = z.infer<typeof MachineIdSchema>;
export type BallType = z.infer<typeof BallTypeSchema>;
export type PitchType = z.infer<typeof PitchTypeSchema>;
export type BookingStatus = z.infer<typeof BookingStatusSchema>;
export type OperationMode = z.infer<typeof OperationModeSchema>;
export type MachineCategory = z.infer<typeof MachineCategorySchema>;
export type TimeSlab = z.infer<typeof TimeSlabSchema>;
export type AvailableSlot = z.infer<typeof AvailableSlotSchema>;
export type Booking = z.infer<typeof BookingSchema>;
export type BookSlotRequest = z.infer<typeof BookSlotRequestSchema>;
export type PackageValidationRequest = z.infer<typeof PackageValidationRequestSchema>;
export type PackageValidationResponse = z.infer<typeof PackageValidationResponseSchema>;
export type MachineConfig = z.infer<typeof MachineConfigSchema>;
export type MachineInfo = z.infer<typeof MachineInfoSchema>;
export type UserPackage = z.infer<typeof UserPackageSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
