/**
 * Ledger list filtering — shared by the list endpoint and the CSV
 * export so an exported file always contains exactly the rows the admin
 * is looking at on screen.
 *
 * Lives in `lib/` rather than next to the route because a Next.js
 * `route.ts` may only export HTTP handlers and the known config fields.
 */

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { dateStringToUTC } from '@/lib/time';
import {
  LEDGER_EXPENSE_CATEGORIES,
  LEDGER_PAYMENT_METHODS,
  LEDGER_REVENUE_CATEGORIES,
} from '@/lib/ledger';

export const LEDGER_PAGE_SIZE = 50;

const ListQuerySchema = z.object({
  kind: z.enum(['REVENUE', 'EXPENSE']).default('REVENUE'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // One `category` param covers both kinds; validated against the
  // relevant enum below once we know the kind.
  category: z.string().optional(),
  paymentMethod: z.enum(LEDGER_PAYMENT_METHODS).optional(),
  recordedById: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type LedgerWhereResult =
  | { where: Prisma.LedgerEntryWhereInput; page: number; kind: 'REVENUE' | 'EXPENSE' }
  | { error: string };

/** Translate the query string into a center-scoped Prisma `where`. */
export function buildLedgerWhere(centerId: string, params: URLSearchParams): LedgerWhereResult {
  // Drop empty values so `?category=` behaves like "no filter" instead
  // of failing the enum check.
  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (v !== '') raw[k] = v;
  }

  const parsed = ListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || 'Invalid filters' };
  }
  const { kind, from, to, category, paymentMethod, recordedById, q, page } = parsed.data;

  const where: Prisma.LedgerEntryWhereInput = { centerId, kind };

  // Swap an inverted range rather than returning nothing, matching the
  // dashboard's defensive handling of the same pair of inputs.
  let gte = from ? dateStringToUTC(from) : undefined;
  let lte = to ? dateStringToUTC(to) : undefined;
  if (gte && lte && gte.getTime() > lte.getTime()) [gte, lte] = [lte, gte];
  if (gte || lte) where.entryDate = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };

  if (category) {
    if (kind === 'REVENUE') {
      if (!(LEDGER_REVENUE_CATEGORIES as readonly string[]).includes(category)) {
        return { error: 'Unknown revenue category' };
      }
      where.revenueCategory = category as Prisma.LedgerEntryWhereInput['revenueCategory'];
    } else {
      if (!(LEDGER_EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
        return { error: 'Unknown expense category' };
      }
      where.expenseCategory = category as Prisma.LedgerEntryWhereInput['expenseCategory'];
    }
  }

  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (recordedById) where.recordedById = recordedById;

  // Free-text search across the name-ish columns of both kinds, so one
  // search box serves the Revenue and Expenses tabs.
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: 'insensitive' } },
      { paidTo: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { remarks: { contains: q, mode: 'insensitive' } },
    ];
  }

  return { where, page, kind };
}
