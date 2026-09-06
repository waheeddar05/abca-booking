/**
 * Bulk-load the Cricket Store catalog from a manifest plus a folder of photos.
 *
 * Admin → Cricket Store is the right tool for one product. This is the
 * right tool for a supplier's asset pack: a dozen products, several
 * photos each, landed in one pass and re-runnable when the supplier
 * sends a correction.
 *
 *   npx tsx scripts/seed-shop-products.ts --manifest scripts/kis-catalog.json --images ~/kis-assets --dry-run
 *   npx tsx scripts/seed-shop-products.ts --manifest scripts/kis-catalog.json --images ~/kis-assets
 *   npx tsx scripts/seed-shop-products.ts --manifest scripts/kis-catalog.json --images ~/kis-assets --replace-images
 *
 * Flags:
 *   --manifest <path>   JSON catalog (required)
 *   --images <dir>      root the manifest's image paths resolve against (required when any are listed)
 *   --dry-run           validate and print the plan; write nothing
 *   --publish           land rows with isActive=true (default: hidden)
 *   --replace-images    delete a product's existing photos and re-upload
 *   --as <id>           email or mobile of the user to record as createdBy
 *
 * Photos need no JSON: with --images pointing at the supplier's pack,
 * a product's pictures are whatever sits in the folder named after its
 * sku (`<images>/KIS-CLS-KW/01.jpg`, filename order, first = the card
 * thumbnail). An explicit `images` array in the manifest overrides that.
 *
 * Products are matched on `sku`, so a re-run updates in place rather than
 * duplicating. Photos are uploaded only for a product that has none,
 * unless --replace-images: image ids are the immutable cache keys behind
 * /api/shop/images/[id], so a re-run to fix a price must not churn them.
 *
 * Everything is validated before anything is written — products against
 * ProductInputSchema (the same schema POST /api/admin/shop/products
 * uses) and photos against the same sniff/size/count rules as the upload
 * route. A manifest with one bad row writes nothing.
 *
 * Nothing is published by default: new rows land with isActive=false so
 * the catalog can be priced and proofread in the admin before /shop shows
 * it. On an existing row the published state is left alone unless
 * --publish is given, so a re-run to fix a price cannot pull a live
 * catalog off the storefront.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import {
  MARKETPLACE_CATEGORY_IDS,
  MARKETPLACE_LIMITS,
  ProductInputSchema,
  formatRupees,
  readImageDimensions,
  sniffImageType,
  type ProductInput,
} from '../src/lib/marketplace';

// ─── CLI ─────────────────────────────────────────────────────────────

interface Options {
  manifest: string;
  imagesDir: string | null;
  dryRun: boolean;
  publish: boolean;
  replaceImages: boolean;
  as: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    manifest: '',
    imagesDir: null,
    dryRun: false,
    publish: false,
    replaceImages: false,
    as: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--manifest': opts.manifest = next(); break;
      case '--images': opts.imagesDir = next(); break;
      case '--as': opts.as = next(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--publish': opts.publish = true; break;
      case '--replace-images': opts.replaceImages = true; break;
      case '--help': case '-h': printUsage(); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.manifest) throw new Error('--manifest is required (see --help)');
  return opts;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npx tsx scripts/seed-shop-products.ts --manifest <file.json> [--images <dir>] [flags]',
      '',
      '  --manifest <path>   JSON catalog (required)',
      '  --images <dir>      root the manifest image paths resolve against',
      '  --dry-run           validate and print the plan; write nothing',
      '  --publish           land rows with isActive=true (default: hidden)',
      '  --replace-images    delete existing photos and re-upload',
      '  --as <email|mobile> user recorded as createdBy',
    ].join('\n'),
  );
}

// ─── Manifest ────────────────────────────────────────────────────────

/**
 * The manifest is hand-edited, so it is parsed strictly and reported per
 * field. `sku` is required here even though the column is nullable: it
 * is the key a re-run matches on, and a catalog row without one could
 * only ever be inserted again.
 */
const ManifestProductSchema = z
  .object({
    sku: z.string().trim().min(1, 'sku is required — it is the re-run match key').max(MARKETPLACE_LIMITS.sku),
    name: z.string().trim().min(2).max(MARKETPLACE_LIMITS.name),
    category: z.enum(MARKETPLACE_CATEGORY_IDS),
    brand: z.string().trim().max(MARKETPLACE_LIMITS.brand).nullish(),
    description: z.string().trim().max(MARKETPLACE_LIMITS.description).nullish(),
    price: z.number().positive().max(MARKETPLACE_LIMITS.maxPrice),
    mrp: z.number().positive().max(MARKETPLACE_LIMITS.maxPrice).nullish(),
    stockQty: z.number().int().min(0).max(MARKETPLACE_LIMITS.maxStock).nullish(),
    inStock: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    displayOrder: z.number().int().min(-1000).max(100_000).optional(),
    sizes: z.array(z.string().trim().min(1).max(MARKETPLACE_LIMITS.sizeLabel)).optional(),
    specs: z
      .array(z.object({ label: z.string().trim().min(1), value: z.string().trim().min(1) }))
      .optional(),
    images: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const ManifestSchema = z
  .object({
    note: z.string().optional(),
    products: z.array(ManifestProductSchema).min(1, 'the manifest has no products'),
  })
  .strict();

type ManifestProduct = z.infer<typeof ManifestProductSchema>;

// ─── Image loading ───────────────────────────────────────────────────

interface LoadedImage {
  path: string;
  /**
   * Copied out of the Buffer node hands back: `readFileSync` returns a
   * view into a shared pool, and both the Prisma `Bytes` column and
   * `readImageDimensions`' DataView want bytes that own their buffer.
   */
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  width: number | null;
  height: number | null;
  alt: string;
}

/**
 * Read and validate one photo against exactly the rules the upload route
 * enforces: a size ceiling on the bytes actually read, and a stored
 * content type sniffed from the header rather than taken from the
 * filename.
 */
function loadImage(root: string, rel: string, alt: string): LoadedImage {
  const path = isAbsolute(rel) ? rel : join(root, rel);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`image not found: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`not a file: ${path}`);
  if (stat.size === 0) throw new Error(`image is empty: ${path}`);
  if (stat.size > MARKETPLACE_LIMITS.maxImageBytes) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    const cap = Math.round(MARKETPLACE_LIMITS.maxImageBytes / (1024 * 1024));
    throw new Error(`image is ${mb} MB, over the ${cap} MB ceiling — resize it: ${path}`);
  }
  const bytes = new Uint8Array(readFileSync(path)) as Uint8Array<ArrayBuffer>;
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new Error(`not a JPEG, PNG or WebP: ${path}`);
  const dims = readImageDimensions(bytes, contentType);
  return {
    path,
    bytes,
    contentType,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    alt: alt.slice(0, 160),
  };
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

/**
 * The photos for a sku when the manifest does not name them: every image
 * file directly inside `<imagesRoot>/<sku>/`, in filename order, so a
 * supplier's pack drops in as-is and "01.jpg" becomes the card
 * thumbnail. A missing folder is not an error — a product simply has no
 * photos yet.
 */
function discoverImages(imagesRoot: string, sku: string): string[] {
  const dir = join(imagesRoot, sku);
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => !name.startsWith('.') && IMAGE_EXTENSIONS.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => join(sku, name));
}

// ─── Plan ────────────────────────────────────────────────────────────

interface PlannedProduct {
  sku: string;
  input: ProductInput;
  images: LoadedImage[];
  existingId: string | null;
  existingImageCount: number;
}

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL || '').host || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Shape a manifest row into the API's product input, then validate it with the API's schema. */
function toProductInput(row: ManifestProduct, publish: boolean): ProductInput {
  const parsed = ProductInputSchema.safeParse({
    name: row.name,
    category: row.category,
    brand: row.brand ?? null,
    sku: row.sku,
    description: row.description ?? null,
    price: row.price,
    mrp: row.mrp ?? null,
    stockQty: row.stockQty ?? null,
    inStock: row.inStock ?? true,
    isActive: publish,
    isFeatured: row.isFeatured ?? false,
    displayOrder: row.displayOrder ?? 0,
    sizes: row.sizes ?? [],
    specs: row.specs ?? [],
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${issue?.path.join('.') || 'product'}: ${issue?.message || 'validation failed'}`);
  }
  return parsed.data;
}

/**
 * Resolve the user recorded as `createdBy`. Explicit --as wins; otherwise
 * the first store admin, then the first super admin. The column is
 * nullable, so an environment with neither still seeds — the rows just
 * carry no author.
 */
async function resolveAuthorId(as: string | null): Promise<string | null> {
  if (as) {
    const digits = as.replace(/\D/g, '');
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: as, mode: 'insensitive' } },
          ...(digits.length >= 10 ? [{ mobileNumber: { endsWith: digits.slice(-10) } }] : []),
        ],
      },
      select: { id: true, email: true, mobileNumber: true },
    });
    if (!user) throw new Error(`--as ${as}: no such user`);
    return user.id;
  }
  const admin = await prisma.user.findFirst({
    where: { OR: [{ isStoreAdmin: true }, { isSuperAdmin: true }] },
    orderBy: [{ isStoreAdmin: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return admin?.id ?? null;
}

async function buildPlan(rows: ManifestProduct[], opts: Options): Promise<PlannedProduct[]> {
  const errors: string[] = [];
  const plan: PlannedProduct[] = [];
  const seen = new Set<string>();
  const imagesRoot = opts.imagesDir ? resolve(opts.imagesDir) : null;

  for (const row of rows) {
    const label = `${row.sku} (${row.name})`;
    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      errors.push(`${label}: sku appears twice in the manifest`);
      continue;
    }
    seen.add(key);

    let input: ProductInput;
    try {
      input = toProductInput(row, opts.publish);
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      continue;
    }

    // An explicit list is authoritative; otherwise take whatever is in
    // the sku's folder under --images.
    const explicit = row.images ?? null;
    if (explicit && explicit.length > 0 && !imagesRoot) {
      errors.push(`${label}: lists photos but --images was not given`);
      continue;
    }
    const files = explicit ?? (imagesRoot ? discoverImages(imagesRoot, row.sku) : []);
    if (files.length > MARKETPLACE_LIMITS.maxImages) {
      errors.push(
        `${label}: ${files.length} photos ${explicit ? 'listed' : `in ${row.sku}/`}, the cap is ${MARKETPLACE_LIMITS.maxImages}`,
      );
      continue;
    }

    const images: LoadedImage[] = [];
    let imageFailed = false;
    for (const rel of files) {
      try {
        images.push(loadImage(imagesRoot!, rel, row.name));
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
        imageFailed = true;
      }
    }
    if (imageFailed) continue;

    // sku is not unique at the database level, so a duplicate is possible
    // and must be reported rather than silently updating an arbitrary one.
    const matches = await prisma.marketplaceProduct.findMany({
      where: { sku: row.sku },
      select: { id: true, _count: { select: { images: true } } },
    });
    if (matches.length > 1) {
      errors.push(`${label}: ${matches.length} existing products share this sku — de-duplicate them in the admin first`);
      continue;
    }

    plan.push({
      sku: row.sku,
      input,
      images,
      existingId: matches[0]?.id ?? null,
      existingImageCount: matches[0]?._count.images ?? 0,
    });
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s) — nothing was written:\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    throw new Error('manifest validation failed');
  }
  return plan;
}

// ─── Apply ───────────────────────────────────────────────────────────

async function applyProduct(p: PlannedProduct, authorId: string | null, opts: Options): Promise<string> {
  const { specs, isActive, ...fields } = p.input;
  const data = { ...fields, specs: specs as Prisma.InputJsonValue };

  // `isActive` is only ever written upward from here. A product's
  // published state is an admin's decision made in the UI, and a re-run
  // to correct a price must not quietly pull the whole catalog off
  // /shop — so an update sets it only when --publish asks for it.
  const productId = p.existingId
    ? (
        await prisma.marketplaceProduct.update({
          where: { id: p.existingId },
          data: opts.publish ? { ...data, isActive: true } : data,
          select: { id: true },
        })
      ).id
    : (
        await prisma.marketplaceProduct.create({
          data: { ...data, isActive, createdById: authorId },
          select: { id: true },
        })
      ).id;

  // Photos are left alone on a re-run unless asked: their ids are the
  // forever-cache keys of /api/shop/images/[id], so re-uploading the same
  // picture only invalidates working CDN entries.
  const shouldWriteImages =
    p.images.length > 0 && (opts.replaceImages || p.existingImageCount === 0);
  if (shouldWriteImages) {
    await prisma.$transaction(async (tx) => {
      if (opts.replaceImages) {
        await tx.marketplaceProductImage.deleteMany({ where: { productId } });
      }
      for (let i = 0; i < p.images.length; i++) {
        const img = p.images[i];
        await tx.marketplaceProductImage.create({
          data: {
            productId,
            data: img.bytes,
            contentType: img.contentType,
            sizeBytes: img.bytes.byteLength,
            width: img.width,
            height: img.height,
            alt: img.alt,
            sortOrder: i,
          },
          select: { id: true },
        });
      }
    });
  }
  return productId;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const manifestPath = resolve(opts.manifest);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error(`could not read ${manifestPath}: ${(e as Error).message}`);
  }
  const manifest = ManifestSchema.safeParse(raw);
  if (!manifest.success) {
    const issue = manifest.error.issues[0];
    throw new Error(`${manifestPath}: ${issue?.path.join('.') || ''} ${issue?.message || 'invalid manifest'}`);
  }

  console.log(`DB host:  ${dbHost()}`);
  console.log(`Manifest: ${manifestPath} (${manifest.data.products.length} products)`);
  console.log(`Images:   ${opts.imagesDir ? resolve(opts.imagesDir) : '(none listed)'}`);
  console.log(`Mode:     ${opts.dryRun ? 'DRY RUN' : 'WRITE'}${opts.publish ? ', publishing (isActive=true)' : ', hidden (isActive=false)'}${opts.replaceImages ? ', replacing photos' : ''}`);

  const plan = await buildPlan(manifest.data.products, opts);
  const authorId = opts.dryRun ? null : await resolveAuthorId(opts.as);

  console.log('');
  for (const p of plan) {
    const action = p.existingId ? 'update' : 'create';
    const photos =
      p.images.length === 0
        ? 'no photos'
        : p.existingImageCount > 0 && !opts.replaceImages
          ? `${p.existingImageCount} photo(s) kept`
          : `${p.images.length} photo(s)`;
    const visibility = p.existingId && !opts.publish ? 'visibility unchanged' : opts.publish ? 'published' : 'hidden';
    console.log(
      `  ${action.padEnd(6)} ${p.sku.padEnd(22)} ${formatRupees(p.input.price).padStart(9)}  ${photos}, ${visibility}`,
    );
  }

  if (opts.dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }

  console.log('');
  let created = 0;
  let updated = 0;
  for (const p of plan) {
    const wasNew = !p.existingId;
    await applyProduct(p, authorId, opts);
    if (wasNew) created++;
    else updated++;
  }

  const total = await prisma.marketplaceProduct.count();
  const live = await prisma.marketplaceProduct.count({ where: { isActive: true } });
  console.log(`Created ${created}, updated ${updated}. Catalog now ${total} product(s), ${live} published.`);
  if (!opts.publish) {
    console.log('Rows are hidden — set prices, then publish from Admin → Cricket Store.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`);
    await prisma.$disconnect();
    process.exit(1);
  });
