/**
 * Small helpers shared by the Admin → Marketplace components: the
 * complete-body builder every PATCH needs, the API error reader, and the
 * form class strings so the dialogs all read the same way.
 */

import {
  MARKETPLACE_CATEGORY_IDS,
  isMarketplaceCategory,
  type MarketplaceProductView,
  type ProductInput,
} from '@/lib/marketplace';

/**
 * `PATCH /api/admin/shop/products/[id]` takes the whole product, never a
 * partial — a field can't be blanked in isolation. Every quick toggle on
 * the list (publish, feature) therefore rebuilds the complete input from
 * the row it has and overrides the one flag it changes.
 */
export function productToInput(product: MarketplaceProductView): ProductInput {
  return {
    name: product.name,
    // A stored category is always in the catalog (the API validates on
    // write); the guard only exists so the type is the enum, not `string`.
    category: isMarketplaceCategory(product.category)
      ? product.category
      : MARKETPLACE_CATEGORY_IDS[0],
    brand: product.brand,
    sku: product.sku,
    description: product.description,
    price: product.price,
    mrp: product.mrp,
    stockQty: product.stockQty,
    inStock: product.inStock,
    isActive: product.isActive,
    isFeatured: product.isFeatured,
    displayOrder: product.displayOrder,
    sizes: [...product.sizes],
    specs: product.specs.map((s) => ({ label: s.label, value: s.value })),
  };
}

/** Read `{ error }` off a failed response, falling back to the status. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : `${fallback} (HTTP ${res.status})`;
}

/** "+91 98765 43210" for a stored WhatsApp digit string. */
export function formatWhatsAppDigits(digits: string | null): string {
  if (!digits) return '';
  const national = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (national.length !== 10) return `+${digits}`;
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const inputClass =
  'w-full bg-slate-900/60 border border-white/[0.1] text-white placeholder:text-slate-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] disabled:opacity-50';
export const labelClass =
  'block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-0.5';
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-4 py-2.5 text-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-medium rounded-xl px-4 py-2.5 text-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const dangerButtonClass =
  'inline-flex items-center justify-center gap-2 bg-red-500 hover:bg-red-400 text-white font-bold rounded-xl px-4 py-2.5 text-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
/** Compact icon-first action on a list row: icon always, text on md+. */
export const rowActionClass =
  'inline-flex items-center gap-1.5 px-2 md:px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
