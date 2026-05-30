/**
 * Recurring slot discount evaluation for RESOURCE_BASED centers.
 *
 * Mirrors the per-slot matching used in ABCA's `book/route.ts`, but with
 * the resource-targeting axes (`categories`, `machineRowIds`) instead of
 * the legacy enum (`machineIds`, `pitchTypes`). Promotional offers are
 * already handled by `getAllApplicablePromoDiscounts` and need no parallel
 * helper — promos work on both booking models. Recurring discounts were
 * the missing half for Toplay parity with ABCA.
 *
 * The functions in this file are pure with respect to the rule list — pass
 * pre-fetched rules so the slot grid can compute every slot's discount
 * from a single DB query.
 */

import { prisma } from '@/lib/prisma';
import type { BookingCategory, RecurringSlotDiscount } from '@prisma/client';

/** IST HH:MM extraction without locale dependencies. */
function getISTTime(d: Date): string {
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

/** 0=Sun .. 6=Sat, IST. */
function getISTDay(d: Date): number {
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).getUTCDay();
}

/** Fetch every enabled recurring discount rule at a center. */
export async function getCenterRecurringDiscountRules(centerId: string): Promise<RecurringSlotDiscount[]> {
  return prisma.recurringSlotDiscount.findMany({
    where: { centerId, enabled: true },
  }).catch(() => []);
}

export interface RecurringMatchInput {
  rule: RecurringSlotDiscount;
  startTime: Date;
  category: BookingCategory;
  machineRowId: string | null;
}

/**
 * Does this rule apply to a given slot/category/machine? Audience filter
 * (ALL/SPECIAL/NON_SPECIAL) is intentionally NOT checked here — leave it
 * to the caller so the same match function can drive both the booking
 * computation (knows the user) and the availability response (worst-case
 * preview).
 */
export function recurringRuleMatches({ rule, startTime, category, machineRowId }: RecurringMatchInput): boolean {
  const day = getISTDay(startTime);
  if (!rule.days.includes(day)) return false;
  const time = getISTTime(startTime);
  const ruleStart = rule.slotStartTime.padStart(5, '0');
  const ruleEnd = (rule.slotEndTime || rule.slotStartTime).padStart(5, '0');
  if (time < ruleStart || time >= ruleEnd) return false;
  if (rule.categories.length > 0 && !rule.categories.includes(category)) return false;
  if (category === 'MACHINE' && rule.machineRowIds && rule.machineRowIds.length > 0) {
    if (!machineRowId || !rule.machineRowIds.includes(machineRowId)) return false;
  }
  return true;
}

export interface RecurringDiscountSummary {
  /** Best ALL-or-NON_SPECIAL discount the user qualifies for (₹). */
  baseDiscount: number;
  /** Stacked SPECIAL discounts on top — only when isSpecialUser=true. */
  specialStack: number;
  /** Total ₹ off this slot. baseDiscount + specialStack. */
  total: number;
  /** Human label for the best applied rule (used by badges). */
  label: string | null;
}

/**
 * Resolve a slot's recurring discount using the matched rules. Mirrors the
 * stacking semantics from ABCA's `book/route.ts:402-435`:
 *
 *   - ALL rules: best (max) discount wins. Applies to every user.
 *   - NON_SPECIAL: only when user is not special; best wins, stacked into
 *     the same "base" bucket as ALL.
 *   - SPECIAL: only when user is special; ALL such rules stack on top.
 */
export function computeRecurringDiscountForSlot(args: {
  matches: RecurringSlotDiscount[];
  isConsecutive: boolean;
  isSpecialUser: boolean;
}): RecurringDiscountSummary {
  const key = args.isConsecutive ? 'twoSlotDiscount' : 'oneSlotDiscount';
  let baseDiscount = 0;
  let specialStack = 0;
  let label: string | null = null;

  for (const rule of args.matches) {
    if (rule.appliesTo === 'SPECIAL') {
      if (args.isSpecialUser) {
        specialStack += rule[key];
      }
      continue;
    }
    if (rule.appliesTo === 'NON_SPECIAL' && args.isSpecialUser) continue;
    if (rule[key] > baseDiscount) {
      baseDiscount = rule[key];
      // No name on the schema — fall back to a generic label so the badge
      // still tells the user what kind of discount is applied.
      label = args.isConsecutive ? 'Consecutive offer' : 'Slot offer';
    }
  }

  return {
    baseDiscount,
    specialStack,
    total: baseDiscount + specialStack,
    label,
  };
}
