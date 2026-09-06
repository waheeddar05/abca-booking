/**
 * Delivery addresses on the user's profile (/profile).
 *
 * The marketplace ships physical goods, so a user needs somewhere to send
 * them. Addresses are global to the account (not center-scoped — a home
 * address doesn't change with the center you book at), capped per user,
 * and exactly one can be the default: the one the product page drops
 * into a WhatsApp order message.
 *
 * Pure module — no Prisma — so the profile form and the API validate
 * with the same schema and can never disagree on what an address is.
 */

import { z } from 'zod';

export const MAX_ADDRESSES_PER_USER = 5;

export const ADDRESS_LIMITS = {
  label: 30,
  fullName: 80,
  line1: 120,
  line2: 120,
  landmark: 80,
  city: 60,
  state: 60,
} as const;

/** States and union territories, for the profile form's picker. */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

/**
 * Bare 10-digit Indian mobile from whatever was typed ("+91 98765 43210",
 * "09876543210", "9876543210"), or null when it isn't one.
 */
export function normalizeIndianMobile(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const AddressInputSchema = z.object({
  label: optionalText(ADDRESS_LIMITS.label),
  fullName: z
    .string()
    .trim()
    .min(2, 'Enter the recipient’s name')
    .max(ADDRESS_LIMITS.fullName)
    .refine((v) => /\p{L}/u.test(v), 'Enter the recipient’s name using letters'),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const normalized = normalizeIndianMobile(v);
      if (!normalized) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
        return z.NEVER;
      }
      return normalized;
    }),
  line1: z
    .string()
    .trim()
    .min(3, 'Enter the house / flat and street')
    .max(ADDRESS_LIMITS.line1),
  line2: optionalText(ADDRESS_LIMITS.line2),
  landmark: optionalText(ADDRESS_LIMITS.landmark),
  city: z.string().trim().min(2, 'Enter the city').max(ADDRESS_LIMITS.city),
  state: z.string().trim().min(2, 'Pick the state').max(ADDRESS_LIMITS.state),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  isDefault: z.boolean().optional().default(false),
});

export type AddressInput = z.infer<typeof AddressInputSchema>;

export interface UserAddressView {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Postal-style lines for display and for the WhatsApp order message:
 *   Name
 *   Line 1
 *   Line 2 / Landmark (when present)
 *   City, State PIN
 *   Phone: …
 */
export function formatAddressLines(
  a: Pick<
    UserAddressView,
    'fullName' | 'phone' | 'line1' | 'line2' | 'landmark' | 'city' | 'state' | 'pincode'
  >,
): string[] {
  const lines: string[] = [a.fullName, a.line1];
  if (a.line2) lines.push(a.line2);
  if (a.landmark) lines.push(`Landmark: ${a.landmark}`);
  lines.push(`${a.city}, ${a.state} ${a.pincode}`);
  lines.push(`Phone: ${a.phone}`);
  return lines;
}

/** One-line summary for compact lists ("Home · 12 MG Road, Pune 411001"). */
export function formatAddressSummary(
  a: Pick<UserAddressView, 'label' | 'line1' | 'city' | 'pincode'>,
): string {
  const core = `${a.line1}, ${a.city} ${a.pincode}`;
  return a.label ? `${a.label} · ${core}` : core;
}
