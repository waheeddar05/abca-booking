/**
 * Marketplace — the in-app store (Admin → Marketplace, user-side /shop).
 *
 * PlayOrbit sells cricket gear alongside the booking product: bats first,
 * then gloves, thigh guards, pads and the rest. This module is the single
 * definition of what a product looks like — the category catalog, the
 * validation schema shared by the create and update routes, the
 * per-center launch configuration ("Coming soon"), and the small pure
 * helpers the store pages need (price maths, WhatsApp enquiry links,
 * image sniffing for uploads).
 *
 * Pure module — no Prisma, no server-only imports — so the admin editor,
 * the shop pages and the API routes all read the same definitions.
 * Prisma-side helpers live in `marketplace-server.ts`.
 */

import { z } from 'zod';

/** Per-center policy key. Resolved center → global → `DEFAULT_MARKETPLACE_CONFIG`. */
export const MARKETPLACE_POLICY_KEY = 'MARKETPLACE_CONFIG';

/** User-facing routes, in one place so nav links and deep links can't drift. */
export const SHOP_PATH = '/shop';
export const ADMIN_SHOP_PATH = '/admin/shop';
export const PROFILE_PATH = '/profile';

// ─── Categories ──────────────────────────────────────────────────────

/**
 * Product categories. Stored on the row as a TEXT code (not a Postgres
 * enum) and validated against this list, so adding "Helmets" is a code
 * change, not a migration — the same rule the ledger's expense
 * subcategories follow. Order here is display order everywhere.
 */
export const MARKETPLACE_CATEGORIES = [
  { value: 'BAT', label: 'Cricket Bats', blurb: 'English & Kashmir willow' },
  { value: 'GLOVES', label: 'Batting Gloves', blurb: 'Pro-grade protection & grip' },
  { value: 'THIGH_GUARD', label: 'Thigh Guards', blurb: 'Inner & outer thigh pads' },
  { value: 'PADS', label: 'Batting Pads', blurb: 'Lightweight leg guards' },
  { value: 'HELMET', label: 'Helmets', blurb: 'Certified head protection' },
  { value: 'PROTECTION', label: 'Protective Gear', blurb: 'Arm, chest & abdo guards' },
  { value: 'BALL', label: 'Cricket Balls', blurb: 'Leather & tennis balls' },
  { value: 'KIT_BAG', label: 'Kit Bags', blurb: 'Wheelie & duffle bags' },
  { value: 'SHOES', label: 'Cricket Shoes', blurb: 'Spikes & rubber studs' },
  { value: 'ACCESSORY', label: 'Accessories', blurb: 'Grips, tape, oil & more' },
] as const;

export type MarketplaceCategoryId = (typeof MARKETPLACE_CATEGORIES)[number]['value'];

export const MARKETPLACE_CATEGORY_IDS = MARKETPLACE_CATEGORIES.map((c) => c.value) as [
  MarketplaceCategoryId,
  ...MarketplaceCategoryId[],
];

export function isMarketplaceCategory(code: unknown): code is MarketplaceCategoryId {
  return typeof code === 'string' && (MARKETPLACE_CATEGORY_IDS as string[]).includes(code);
}

/** Label for a stored category code; unknown codes fall back to the code itself. */
export function marketplaceCategoryLabel(code: string | null | undefined): string {
  if (!code) return 'Uncategorised';
  const hit = MARKETPLACE_CATEGORIES.find((c) => c.value === code);
  return hit ? hit.label : code;
}

// ─── Launch configuration (MARKETPLACE_CONFIG policy) ────────────────

export interface MarketplaceConfig {
  /** Master switch. Off hides the store everywhere (nav, landing, /shop). */
  enabled: boolean;
  /**
   * Pre-launch mode: products are browsable but not orderable. Cards carry
   * a "Coming soon" ribbon and the product page offers "Notify me" instead
   * of ordering. Flip off to open enquiries/orders over WhatsApp.
   */
  comingSoon: boolean;
  /** Optional line shown under the store heading ("Launching Diwali 2026"). */
  launchNote: string;
  /**
   * WhatsApp number for enquiries / orders. Blank falls back to the
   * center's contact phone. Stored as typed; normalised on use.
   */
  enquiryPhone: string;
}

export const DEFAULT_MARKETPLACE_CONFIG: MarketplaceConfig = {
  enabled: true,
  comingSoon: true,
  launchNote: '',
  enquiryPhone: '',
};

export const MARKETPLACE_LIMITS = {
  launchNote: 160,
  name: 120,
  brand: 60,
  sku: 40,
  description: 2000,
  specs: 20,
  specLabel: 40,
  specValue: 160,
  sizes: 12,
  sizeLabel: 20,
  maxPrice: 1_000_000,
  maxStock: 100_000,
  maxImages: 8,
  /** Server-side ceiling per upload. The client resizes well under this. */
  maxImageBytes: 3 * 1024 * 1024,
} as const;

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function readText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * Coerce whatever is stored in the policy row into a well-formed config.
 * Tolerant by design (the row is hand-editable): per-field fallback,
 * string booleans accepted, unknown keys dropped, garbage → defaults.
 */
export function normalizeMarketplaceConfig(raw: unknown): MarketplaceConfig {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_MARKETPLACE_CONFIG };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MARKETPLACE_CONFIG };
  }
  const obj = value as Record<string, unknown>;
  return {
    enabled: readBool(obj.enabled, DEFAULT_MARKETPLACE_CONFIG.enabled),
    comingSoon: readBool(obj.comingSoon, DEFAULT_MARKETPLACE_CONFIG.comingSoon),
    launchNote: readText(obj.launchNote, MARKETPLACE_LIMITS.launchNote),
    enquiryPhone: readText(obj.enquiryPhone, 20),
  };
}

/** Strict schema for the admin settings PUT — no coercion, real booleans. */
export const MarketplaceConfigSchema = z.object({
  enabled: z.boolean(),
  comingSoon: z.boolean(),
  launchNote: z.string().trim().max(MARKETPLACE_LIMITS.launchNote, 'Launch note is too long'),
  enquiryPhone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || toWhatsAppDigits(v) !== null, {
      message: 'Enter a valid Indian mobile number (10 digits) or leave blank',
    }),
});

// ─── Product schema ──────────────────────────────────────────────────

export interface ProductSpec {
  label: string;
  value: string;
}

export const ProductSpecSchema = z.object({
  label: z.string().trim().min(1, 'Spec label is required').max(MARKETPLACE_LIMITS.specLabel),
  value: z.string().trim().min(1, 'Spec value is required').max(MARKETPLACE_LIMITS.specValue),
});

/** Optional free-text field: trims, and an empty string becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Product name is required').max(MARKETPLACE_LIMITS.name),
    category: z.enum(MARKETPLACE_CATEGORY_IDS, { message: 'Pick a category' }),
    brand: optionalText(MARKETPLACE_LIMITS.brand),
    sku: optionalText(MARKETPLACE_LIMITS.sku),
    description: optionalText(MARKETPLACE_LIMITS.description),
    price: z
      .number({ message: 'Price is required' })
      .positive('Price must be greater than zero')
      .max(MARKETPLACE_LIMITS.maxPrice, 'Price is unrealistically high'),
    mrp: z
      .number()
      .positive('MRP must be greater than zero')
      .max(MARKETPLACE_LIMITS.maxPrice, 'MRP is unrealistically high')
      .nullable()
      .optional()
      .transform((v) => (v == null ? null : v)),
    stockQty: z
      .number()
      .int('Stock must be a whole number')
      .min(0, 'Stock cannot be negative')
      .max(MARKETPLACE_LIMITS.maxStock)
      .nullable()
      .optional()
      .transform((v) => (v == null ? null : v)),
    inStock: z.boolean().optional().default(true),
    isActive: z.boolean().optional().default(false),
    isFeatured: z.boolean().optional().default(false),
    displayOrder: z.number().int().min(-1000).max(100_000).optional().default(0),
    sizes: z
      .array(z.string().trim().min(1).max(MARKETPLACE_LIMITS.sizeLabel))
      .max(MARKETPLACE_LIMITS.sizes, `At most ${MARKETPLACE_LIMITS.sizes} sizes`)
      .optional()
      .default([])
      // De-duplicate case-insensitively so "SH" and "sh" don't both render.
      .transform((arr) => {
        const seen = new Set<string>();
        return arr.filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }),
    specs: z
      .array(ProductSpecSchema)
      .max(MARKETPLACE_LIMITS.specs, `At most ${MARKETPLACE_LIMITS.specs} specs`)
      .optional()
      .default([]),
  })
  .superRefine((v, ctx) => {
    if (v.mrp != null && v.mrp < v.price) {
      ctx.addIssue({
        code: 'custom',
        path: ['mrp'],
        message: 'MRP cannot be lower than the selling price',
      });
    }
    // A tracked stock of zero and "in stock" contradict each other; the
    // flag is what the shop renders, so make the admin pick one story.
    if (v.stockQty === 0 && v.inStock) {
      ctx.addIssue({
        code: 'custom',
        path: ['inStock'],
        message: 'Stock is 0 — untick "In stock" or enter a quantity',
      });
    }
  });

export type ProductInput = z.infer<typeof ProductInputSchema>;

/** Tolerant reader for the stored `specs` JSON column. */
export function parseProductSpecs(raw: unknown): ProductSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String((item as { label?: unknown }).label ?? '').trim();
    const value = String((item as { value?: unknown }).value ?? '').trim();
    if (label && value) out.push({ label, value });
    if (out.length >= MARKETPLACE_LIMITS.specs) break;
  }
  return out;
}

// ─── View shapes (what the APIs return) ──────────────────────────────

export interface MarketplaceImageMeta {
  id: string;
  /** Same-origin URL served by /api/shop/images/[id]. */
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

export interface MarketplaceProductView {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  brand: string | null;
  sku: string | null;
  description: string | null;
  price: number;
  mrp: number | null;
  /** Whole-percent saving vs MRP, or null when there is no higher MRP. */
  discountPercent: number | null;
  stockQty: number | null;
  inStock: boolean;
  isActive: boolean;
  isFeatured: boolean;
  displayOrder: number;
  sizes: string[];
  specs: ProductSpec[];
  images: MarketplaceImageMeta[];
  primaryImage: MarketplaceImageMeta | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin list rows carry the interest count as a launch-demand signal. */
export interface MarketplaceProductAdminView extends MarketplaceProductView {
  interestCount: number;
}

export interface MarketplaceInterestView {
  id: string;
  userId: string;
  name: string | null;
  mobileNumber: string | null;
  createdAt: string;
}

/** Category chip with a count, for the /shop filter bar. */
export interface MarketplaceCategoryCount {
  value: string;
  label: string;
  count: number;
}

/** `GET /api/shop/status` — the one light payload every highlight reads. */
export interface MarketplaceStatus {
  enabled: boolean;
  comingSoon: boolean;
  launchNote: string;
  /** WhatsApp digits with country code (e.g. "919876543210"), or null. */
  enquiryPhone: string | null;
  center: { id: string; name: string; slug: string } | null;
  productCount: number;
  /** Up to four published products, featured first — for the landing page. */
  featured: MarketplaceProductView[];
}

// ─── Small pure helpers ──────────────────────────────────────────────

export function productImageUrl(imageId: string): string {
  return `/api/shop/images/${encodeURIComponent(imageId)}`;
}

/** Whole-percent saving, e.g. mrp 2000 / price 1500 → 25. Null when not a saving. */
export function discountPercent(mrp: number | null | undefined, price: number): number | null {
  if (mrp == null || !(mrp > price) || price < 0) return null;
  const pct = Math.round(((mrp - price) / mrp) * 100);
  return pct > 0 ? pct : null;
}

/**
 * Normalise a phone number into the digits WhatsApp's click-to-chat link
 * wants: country code + number, no plus, no spaces. Indian numbers only —
 * a bare 10-digit mobile gets the 91 prefix, "+91 98765 43210" is
 * accepted, anything else is rejected rather than guessed at.
 */
export function toWhatsAppDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^091[6-9]\d{9}$/.test(digits)) return digits.slice(1);
  return null;
}

/** Click-to-chat link with a prefilled message. Null when the number is unusable. */
export function buildWhatsAppLink(phone: string | null | undefined, text: string): string | null {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export interface EnquiryMessageInput {
  product: Pick<MarketplaceProductView, 'name' | 'brand' | 'price'>;
  /** Size the buyer picked, if the product has sizes. */
  size?: string | null;
  quantity?: number;
  /** Delivery address lines (see `formatAddressLines` in addresses.ts). */
  addressLines?: string[] | null;
  /** Absolute product URL, when known. */
  productUrl?: string | null;
  /** Coming-soon → "interested", otherwise a real order request. */
  comingSoon: boolean;
}

/** The prefilled WhatsApp text for the product page's enquiry / order button. */
export function buildEnquiryMessage(input: EnquiryMessageInput): string {
  const { product, size, quantity = 1, addressLines, productUrl, comingSoon } = input;
  const title = product.brand ? `${product.name} (${product.brand})` : product.name;
  const lines: string[] = [];
  lines.push(
    comingSoon
      ? `Hi PlayOrbit, I'm interested in this product from your store:`
      : `Hi PlayOrbit, I'd like to order this from your store:`,
  );
  lines.push(`• ${title} — ${formatRupees(product.price)}`);
  if (size) lines.push(`Size: ${size}`);
  if (!comingSoon) lines.push(`Qty: ${Math.max(1, Math.floor(quantity))}`);
  if (!comingSoon && addressLines && addressLines.length > 0) {
    lines.push('');
    lines.push('Deliver to:');
    lines.push(...addressLines);
  }
  if (productUrl) {
    lines.push('');
    lines.push(productUrl);
  }
  return lines.join('\n');
}

/** ₹ formatting that matches the rest of the app (`formatCurrency`). */
export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

// ─── Upload validation (server-side, no image library) ───────────────

export type UploadImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const ALLOWED_IMAGE_TYPES: ReadonlyArray<UploadImageType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Identify the image format from its first bytes. The declared
 * Content-Type is client-controlled, so the stored type is always the
 * sniffed one — a renamed .exe can't be served back as an image.
 */
export function sniffImageType(bytes: Uint8Array): UploadImageType | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Pixel dimensions straight from the container headers. Enough to store
 * width/height for aspect-ratio boxes without decoding the pixels (there
 * is no image library on the server). Returns null when the header is
 * unusual rather than guessing.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  type: UploadImageType,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === 'image/png') {
      if (bytes.length < 24) return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (type === 'image/jpeg') {
      // Walk the marker segments to the first SOFn (start of frame).
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        // Padding bytes between markers.
        if (marker === 0xff) {
          offset += 1;
          continue;
        }
        // Standalone markers with no length.
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = view.getUint16(offset + 2);
        const isSOF =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isSOF) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        if (marker === 0xda) return null; // start of scan — no SOF seen
        offset += 2 + length;
      }
      return null;
    }
    if (type === 'image/webp') {
      if (bytes.length < 30) return null;
      const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (chunk === 'VP8 ') {
        // Lossy: 14-bit width/height at offset 26/28 (little-endian).
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        };
      }
      if (chunk === 'VP8L') {
        const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
        return {
          width: 1 + (((b1 & 0x3f) << 8) | b0),
          height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        };
      }
      if (chunk === 'VP8X') {
        // Extended: 24-bit width-1 / height-1 at offset 24 / 27.
        return {
          width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
          height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
        };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Stock line for a product card / page. */
export function stockLabel(p: Pick<MarketplaceProductView, 'inStock' | 'stockQty'>): {
  text: string;
  tone: 'ok' | 'low' | 'out';
} {
  if (!p.inStock || p.stockQty === 0) return { text: 'Out of stock', tone: 'out' };
  if (p.stockQty != null && p.stockQty <= 3) return { text: `Only ${p.stockQty} left`, tone: 'low' };
  return { text: 'In stock', tone: 'ok' };
}
