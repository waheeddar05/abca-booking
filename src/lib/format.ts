/**
 * Shared display formatters (client-safe, no Prisma dependency).
 */

/**
 * Format a rupee amount for display, e.g. 1234.5 -> "₹1,235".
 * Matches the existing `₹{n.toLocaleString('en-IN')}` convention used
 * across the app (wallet page, booking cards) so currency reads
 * consistently everywhere.
 */
export function formatCurrency(amount: number | null | undefined): string {
  const value = Math.round(amount ?? 0);
  return `₹${value.toLocaleString('en-IN')}`;
}
