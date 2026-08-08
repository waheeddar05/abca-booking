/**
 * Admin dashboard revenue aggregation — the single place the three revenue
 * cards, the Revenue-by-Category chart and the Revenue-by-Machine chart are
 * derived from, so they reconcile to the rupee.
 *
 * ── The one revenue formula ───────────────────────────────────────────
 *
 *   Revenue = Σ(online) + Σ(wallet) − Σ(refunds)
 *
 * Applied identically to every source of money:
 *
 *   • Booking   — the booking's share of its captured Razorpay payment plus
 *                 the wallet deducted for it, less the refunds raised against
 *                 it. Cash and free bookings collect nothing through these
 *                 rails and contribute 0 (walk-in cash belongs in the Ledger).
 *   • Package   — the full `amountPaid` recognised on the PURCHASE date, less
 *                 the wallet credits refunded for it. Bucketed by the
 *                 package's own category/machine; the sessions it later pays
 *                 for contribute only whatever upgrade they charged on top,
 *                 so nothing is counted twice.
 *   • Ledger    — hand-entered manual revenue, bucketed by the category the
 *                 admin picked.
 *
 * ── Two invariants this module exists to guarantee ────────────────────
 *
 *   1. Σ(every category bar)  === totalRevenue
 *   2. Σ(every machine bar)   === the MACHINE category bar
 *
 * Both hold *by construction*: every row is added to exactly one category
 * bucket, `totalRevenue` is the sum of the buckets rather than a separately
 * computed figure, and a MACHINE row is always mirrored into exactly one
 * machine bucket (falling back to a named catch-all when the row names no
 * machine). `dashboard-revenue.test.ts` asserts them.
 *
 * ── Statuses ─────────────────────────────────────────────────────────
 *
 * CANCELLED bookings and CANCELLED packages are INCLUDED, net of their
 * refunds. Revenue is the money the center kept, and a cancellation that
 * retained a fee kept money: dropping the row entirely reported that fee as
 * ₹0. A fully refunded cancellation nets to 0 on its own and needs no
 * special-casing.
 */

/** Machine-chart bucket for MACHINE revenue that names no specific machine —
 *  a booking with no assigned machine, or a legacy row with no machine id. */
export const UNATTRIBUTED_MACHINE_LABEL = 'Other';

/** Machine-chart bucket for hand-entered Ledger revenue filed under the
 *  Bowling Machine category. A manual entry records a category but never a
 *  machine, and the bars must still sum to the MACHINE category bar, so it
 *  gets its own clearly-named column instead of being silently dropped. */
export const MANUAL_MACHINE_LABEL = 'Manual Entry';

/** The category every uncategorised row falls into. Legacy ABCA packages
 *  carry a null category and are bowling-machine packages. */
export const DEFAULT_REVENUE_CATEGORY = 'MACHINE';

/** One money-bearing row: a booking, a package purchase, or a ledger entry. */
export interface RevenueRow {
  /** BookingCategory value, or 'OTHER' for ledger income with no service. */
  category: string;
  online: number;
  wallet: number;
  /** Non-failed refunds raised against this row. */
  refunds: number;
  /**
   * Machine this row is attributable to. Only read for MACHINE-category rows;
   * null routes the amount to `UNATTRIBUTED_MACHINE_LABEL`.
   */
  machineName?: string | null;
}

export interface RevenueBucket {
  key: string;
  amount: number;
}

export interface RevenueAggregate {
  /** Σ over every category bucket. */
  totalRevenue: number;
  /** One entry per category that saw money, largest first. */
  byCategory: RevenueBucket[];
  /** One entry per machine bucket, largest first. Sums to the MACHINE
   *  category bucket. Empty when there is no machine revenue at all. */
  byMachine: RevenueBucket[];
}

/** Revenue = online + wallet − refunds. Signed: a row refunded for more than
 *  it collected pulls its bucket down, which is what keeps a multi-slot
 *  order's total honest (see `splitAmountNetSigned`). */
export function rowRevenue(row: RevenueRow): number {
  return (row.online || 0) + (row.wallet || 0) - (row.refunds || 0);
}

/** Round to paise so float drift never leaves the invariants a rupee short. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toSortedBuckets(map: Map<string, number>): RevenueBucket[] {
  return Array.from(map.entries())
    .map(([key, amount]) => ({ key, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

/**
 * Fold every row into its category bucket (and, for MACHINE rows, its machine
 * bucket), then derive the total from the buckets so the two invariants above
 * can never drift apart.
 */
export function aggregateRevenue(rows: RevenueRow[]): RevenueAggregate {
  const byCategory = new Map<string, number>();
  const byMachine = new Map<string, number>();

  for (const row of rows) {
    const value = rowRevenue(row);
    const category = row.category || DEFAULT_REVENUE_CATEGORY;
    byCategory.set(category, (byCategory.get(category) || 0) + value);

    if (category === 'MACHINE') {
      const bucket = row.machineName?.trim() || UNATTRIBUTED_MACHINE_LABEL;
      byMachine.set(bucket, (byMachine.get(bucket) || 0) + value);
    }
  }

  // Drop buckets that netted to exactly zero — a category whose only activity
  // was a fully-refunded booking is noise on the chart, not information. Any
  // non-zero bucket stays, including a negative one: a window whose refunds
  // outran its collections is a real (and worth-seeing) result.
  const categoryBuckets = toSortedBuckets(byCategory).filter(b => b.amount !== 0);
  const machineBuckets = toSortedBuckets(byMachine).filter(b => b.amount !== 0);

  return {
    totalRevenue: round2(categoryBuckets.reduce((sum, b) => sum + b.amount, 0)),
    byCategory: categoryBuckets,
    byMachine: machineBuckets,
  };
}
