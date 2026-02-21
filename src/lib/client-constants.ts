/**
 * Client-side constants (no Prisma dependency).
 * Use for React components that need machine/pitch/ball metadata.
 */
import type { MachineId, MachineCategory } from '@/lib/schemas';

// ─── Machine Cards (UI) ─────────────────────────────────
export interface MachineCard {
  id: MachineId;
  label: string;
  shortLabel: string;
  category: MachineCategory;
  image: string;
  dotColor: string;
  activeRing: string;
  activeBg: string;
}

export const MACHINE_CARDS: MachineCard[] = [
  {
    id: 'GRAVITY',
    label: 'Gravity',
    shortLabel: 'Leather',
    category: 'LEATHER',
    image: '/images/leathermachine.jpeg',
    dotColor: 'bg-transparent',
    activeRing: 'ring-amber-500/50',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'YANTRA',
    label: 'Yantra',
    shortLabel: 'Premium Leather',
    category: 'LEATHER',
    image: '/images/yantra-machine.jpeg',
    dotColor: 'bg-transparent',
    activeRing: 'ring-amber-500/50',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'LEVERAGE_INDOOR',
    label: 'Leverage Tennis',
    shortLabel: 'Indoor',
    category: 'TENNIS',
    image: '/images/tennismachine.jpeg',
    dotColor: 'bg-transparent',
    activeRing: 'ring-amber-500/50',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'LEVERAGE_OUTDOOR',
    label: 'Leverage Tennis',
    shortLabel: 'Outdoor',
    category: 'TENNIS',
    image: '/images/tennismachine.jpeg',
    dotColor: 'bg-transparent',
    activeRing: 'ring-amber-500/50',
    activeBg: 'bg-amber-500/10',
  },
];

// ─── Pitch Types (UI) ───────────────────────────────────
export const PITCH_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ASTRO: { label: 'Astro Turf', color: 'bg-emerald-500' },
  CEMENT: { label: 'Cement', color: 'bg-amber-500' },
  NATURAL: { label: 'Natural Turf', color: 'bg-lime-500' },
  TURF: { label: 'Cement Wicket', color: 'bg-amber-500' },
};

// ─── Ball Types (UI) ────────────────────────────────────
export const BALL_TYPES = [
  { value: 'LEATHER', label: 'Leather Ball', color: 'bg-red-500' },
  { value: 'MACHINE', label: 'Machine Ball', color: 'bg-green-500' },
  { value: 'TENNIS', label: 'Tennis Ball', color: 'bg-yellow-500' },
] as const;

// ─── Booking Status ─────────────────────────────────────
export const BOOKING_STATUS_CONFIG = {
  BOOKED: { label: 'Upcoming', bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-500' },
  DONE: { label: 'Completed', bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-500' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-white/[0.04]', text: 'text-slate-400', dot: 'bg-slate-500' },
} as const;

export const BALL_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  TENNIS: { color: 'bg-green-500', label: 'Tennis' },
  LEATHER: { color: 'bg-red-500', label: 'Leather' },
  MACHINE: { color: 'bg-blue-500', label: 'Machine' },
};

// ─── Contact ─────────────────────────────────────────────
export const CONTACT_NUMBERS = [
  { name: 'Pratyush', number: '7058683664' },
  { name: 'Rahul', number: '7774077995' },
] as const;

export const INSTAGRAM_URL = 'https://www.instagram.com/ankeetbawanecricketacademy?igsh=MWFvd2p0MzlrOWQ1Mg%3D%3D';

// ─── Helpers ─────────────────────────────────────────────
export function getMachineCard(id: MachineId): MachineCard {
  const card = MACHINE_CARDS.find(m => m.id === id);
  if (!card) throw new Error(`Unknown machine ID: ${id}`);
  return card;
}

export function isLeatherCategory(category: MachineCategory): boolean {
  return category === 'LEATHER';
}
