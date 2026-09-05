/**
 * Marketplace — Prisma-side helpers shared by the /api/shop and
 * /api/admin/shop routes. Everything pure (schemas, labels, config
 * normalisation) lives in `marketplace.ts`; this file is the only place
 * that knows the table shapes.
 *
 * Image storage note: photos live in Postgres as bytea and are served by
 * `/api/shop/images/[id]`. That keeps the feature zero-config on every
 * environment (no blob store token to provision) at a scale of a few
 * dozen products with client-resized photos. All storage access is
 * routed through this module — `storeProductImage` / `loadProductImage`
 * — so moving to an object store later is a change here, not in the
 * routes.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getPolicyJson } from '@/lib/policy';
import type { CenterSummary } from '@/lib/centers';
import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_MARKETPLACE_CONFIG,
  MARKETPLACE_LIMITS,
  MARKETPLACE_POLICY_KEY,
  discountPercent,
  marketplaceCategoryLabel,
  normalizeMarketplaceConfig,
  parseProductSpecs,
  productImageUrl,
  readImageDimensions,
  sniffImageType,
  toWhatsAppDigits,
  type MarketplaceConfig,
  type MarketplaceImageMeta,
  type MarketplaceProductView,
} from '@/lib/marketplace';

// ─── Config ──────────────────────────────────────────────────────────

/** Resolved MARKETPLACE_CONFIG for a center (center → global → default). */
export async function getMarketplaceConfig(centerId: string | null): Promise<MarketplaceConfig> {
  const raw = await getPolicyJson<unknown>(MARKETPLACE_POLICY_KEY, centerId, null);
  return raw == null ? { ...DEFAULT_MARKETPLACE_CONFIG } : normalizeMarketplaceConfig(raw);
}

/**
 * The WhatsApp number enquiries go to: the store's own configured number
 * first, then the center's contact list, then its single contact phone.
 * Returned as click-to-chat digits ("91…") or null when nothing usable.
 */
export function resolveEnquiryPhone(
  config: MarketplaceConfig,
  center: Pick<CenterSummary, 'contactPhone' | 'contactPhones'> | null,
): string | null {
  const candidates: Array<string | null | undefined> = [config.enquiryPhone];
  if (center) {
    const list = Array.isArray(center.contactPhones) ? center.contactPhones : [];
    for (const c of list) candidates.push(c?.number);
    candidates.push(center.contactPhone);
  }
  for (const c of candidates) {
    const digits = toWhatsAppDigits(c);
    if (digits) return digits;
  }
  return null;
}

// ─── Selects + mappers ───────────────────────────────────────────────

/** Image metadata only — never the bytes. */
export const PRODUCT_IMAGE_META_SELECT = {
  id: true,
  alt: true,
  width: true,
  height: true,
  sortOrder: true,
  contentType: true,
  sizeBytes: true,
} satisfies Prisma.MarketplaceProductImageSelect;

export const PRODUCT_SELECT = {
  id: true,
  centerId: true,
  name: true,
  category: true,
  brand: true,
  sku: true,
  description: true,
  price: true,
  mrp: true,
  stockQty: true,
  inStock: true,
  isActive: true,
  isFeatured: true,
  displayOrder: true,
  sizes: true,
  specs: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: PRODUCT_IMAGE_META_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.MarketplaceProductSelect;

export type ProductRow = Prisma.MarketplaceProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

/** Featured first, then the admin's manual order, newest last-added first. */
export const PRODUCT_ORDER_BY: Prisma.MarketplaceProductOrderByWithRelationInput[] = [
  { isFeatured: 'desc' },
  { displayOrder: 'asc' },
  { createdAt: 'desc' },
];

export function toImageMeta(img: {
  id: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
}): MarketplaceImageMeta {
  return {
    id: img.id,
    url: productImageUrl(img.id),
    alt: img.alt,
    width: img.width,
    height: img.height,
    sortOrder: img.sortOrder,
  };
}

export function toProductView(row: ProductRow): MarketplaceProductView {
  const images = row.images.map(toImageMeta);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categoryLabel: marketplaceCategoryLabel(row.category),
    brand: row.brand,
    sku: row.sku,
    description: row.description,
    price: row.price,
    mrp: row.mrp,
    discountPercent: discountPercent(row.mrp, row.price),
    stockQty: row.stockQty,
    inStock: row.inStock,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    displayOrder: row.displayOrder,
    sizes: row.sizes,
    specs: parseProductSpecs(row.specs),
    images,
    primaryImage: images[0] ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Image storage ───────────────────────────────────────────────────

export type ImageUpload =
  | {
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      contentType: (typeof ALLOWED_IMAGE_TYPES)[number];
      width: number | null;
      height: number | null;
      alt: string | null;
    }
  | { ok: false; error: string; status: number };

/**
 * Read and validate a multipart upload (`file` + optional `alt`). The
 * stored content type is the sniffed one, never the declared one, and
 * the size ceiling is enforced on the bytes actually received.
 */
export async function readImageUpload(req: NextRequest): Promise<ImageUpload> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, error: 'Expected a multipart form upload', status: 400 };
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return { ok: false, error: 'No image file in the upload', status: 400 };
  }
  if (file.size === 0) {
    return { ok: false, error: 'The image file is empty', status: 400 };
  }
  if (file.size > MARKETPLACE_LIMITS.maxImageBytes) {
    const mb = Math.round(MARKETPLACE_LIMITS.maxImageBytes / (1024 * 1024));
    return { ok: false, error: `Image is too large — keep it under ${mb} MB`, status: 413 };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { ok: false, error: 'Only JPEG, PNG and WebP images are accepted', status: 415 };
  }
  const dims = readImageDimensions(bytes, contentType);
  const altRaw = form.get('alt');
  const alt = typeof altRaw === 'string' ? altRaw.trim().slice(0, 160) || null : null;
  return {
    ok: true,
    bytes,
    contentType,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    alt,
  };
}

/** Persist an upload as the last image of a product. */
export async function storeProductImage(productId: string, upload: Extract<ImageUpload, { ok: true }>) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.marketplaceProductImage.count({ where: { productId } });
    if (count >= MARKETPLACE_LIMITS.maxImages) {
      throw new ImageLimitError();
    }
    const last = await tx.marketplaceProductImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return tx.marketplaceProductImage.create({
      data: {
        productId,
        data: upload.bytes,
        contentType: upload.contentType,
        sizeBytes: upload.bytes.byteLength,
        width: upload.width,
        height: upload.height,
        alt: upload.alt,
        sortOrder: last ? last.sortOrder + 1 : 0,
      },
      select: PRODUCT_IMAGE_META_SELECT,
    });
  });
}

export class ImageLimitError extends Error {
  constructor() {
    super(`A product can have at most ${MARKETPLACE_LIMITS.maxImages} images`);
    this.name = 'ImageLimitError';
  }
}

/** Load the bytes for the public image route. */
export async function loadProductImage(id: string) {
  return prisma.marketplaceProductImage.findUnique({
    where: { id },
    select: { id: true, data: true, contentType: true, sizeBytes: true },
  });
}

/**
 * Binary response with a year-long immutable cache: an image row is
 * never modified in place (replace = delete + upload = new id), so the
 * id is a safe forever-cache key for browsers and the CDN alike.
 */
export function imageResponse(row: { id: string; data: Uint8Array; contentType: string }): NextResponse {
  const body = Buffer.from(row.data);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${row.id}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
