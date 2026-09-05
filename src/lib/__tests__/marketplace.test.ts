import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MARKETPLACE_CONFIG,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_IDS,
  MARKETPLACE_LIMITS,
  MarketplaceConfigSchema,
  ProductInputSchema,
  buildEnquiryMessage,
  buildWhatsAppLink,
  discountPercent,
  formatRupees,
  isMarketplaceCategory,
  marketplaceCategoryLabel,
  normalizeMarketplaceConfig,
  parseProductSpecs,
  readImageDimensions,
  sniffImageType,
  stockLabel,
  toWhatsAppDigits,
} from '@/lib/marketplace';
import { CATEGORY_ICONS } from '@/components/shop/categoryIcons';

// ─── Launch configuration ────────────────────────────────────────────

describe('normalizeMarketplaceConfig', () => {
  it('falls back to the defaults for garbage, arrays and invalid JSON', () => {
    for (const raw of [undefined, null, 7, true, '', 'garbage', '{not json', [], ['enabled']]) {
      expect(normalizeMarketplaceConfig(raw), `raw=${JSON.stringify(raw)}`).toEqual(
        DEFAULT_MARKETPLACE_CONFIG,
      );
    }
  });

  it('defaults to enabled + coming soon with no note and no phone', () => {
    expect(DEFAULT_MARKETPLACE_CONFIG).toEqual({
      enabled: true,
      comingSoon: true,
      launchNote: '',
      enquiryPhone: '',
    });
  });

  it('returns a fresh object — mutating the result cannot corrupt the defaults', () => {
    const config = normalizeMarketplaceConfig(null);
    config.enabled = false;
    config.launchNote = 'changed';
    expect(DEFAULT_MARKETPLACE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_MARKETPLACE_CONFIG.launchNote).toBe('');
  });

  it('parses a JSON string the way the policy row stores it', () => {
    const config = normalizeMarketplaceConfig(
      '{"enabled":false,"comingSoon":false,"launchNote":"Diwali 2026","enquiryPhone":"9876543210"}',
    );
    expect(config).toEqual({
      enabled: false,
      comingSoon: false,
      launchNote: 'Diwali 2026',
      enquiryPhone: '9876543210',
    });
  });

  it('tolerates the string booleans a hand-edited policy row can carry', () => {
    const config = normalizeMarketplaceConfig({ enabled: 'true', comingSoon: '0' });
    expect(config.enabled).toBe(true);
    expect(config.comingSoon).toBe(false);
  });

  it('keeps a field at its default when the stored value is junk', () => {
    const config = normalizeMarketplaceConfig({ enabled: 'maybe', comingSoon: { on: true } });
    expect(config.enabled).toBe(DEFAULT_MARKETPLACE_CONFIG.enabled);
    expect(config.comingSoon).toBe(DEFAULT_MARKETPLACE_CONFIG.comingSoon);
  });

  it('drops unknown keys', () => {
    const config = normalizeMarketplaceConfig({ enabled: true, cart: true, theme: 'dark' });
    expect(Object.keys(config).sort()).toEqual(['comingSoon', 'enabled', 'enquiryPhone', 'launchNote']);
  });

  it('trims the launch note and caps it at the limit', () => {
    const long = `   ${'x'.repeat(MARKETPLACE_LIMITS.launchNote + 40)}   `;
    const config = normalizeMarketplaceConfig({ launchNote: long });
    expect(config.launchNote).toHaveLength(MARKETPLACE_LIMITS.launchNote);
    expect(config.launchNote.startsWith('x')).toBe(true);
    expect(MARKETPLACE_LIMITS.launchNote).toBe(160);
  });

  it('reads a non-string launch note or phone as blank', () => {
    const config = normalizeMarketplaceConfig({ launchNote: 42, enquiryPhone: null });
    expect(config.launchNote).toBe('');
    expect(config.enquiryPhone).toBe('');
  });

  it('round-trips its own output unchanged', () => {
    const first = normalizeMarketplaceConfig({
      enabled: false,
      comingSoon: true,
      launchNote: 'Launching soon',
      enquiryPhone: '+91 98765 43210',
    });
    expect(normalizeMarketplaceConfig(JSON.stringify(first))).toEqual(first);
  });
});

describe('MarketplaceConfigSchema (admin settings PUT)', () => {
  const valid = { enabled: true, comingSoon: false, launchNote: 'Open now', enquiryPhone: '' };

  it('accepts real booleans and a blank phone', () => {
    expect(MarketplaceConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('does not coerce string booleans — the editor sends real ones', () => {
    expect(MarketplaceConfigSchema.safeParse({ ...valid, enabled: 'true' }).success).toBe(false);
  });

  it('rejects an unusable enquiry phone but accepts a formatted Indian mobile', () => {
    expect(MarketplaceConfigSchema.safeParse({ ...valid, enquiryPhone: '12345' }).success).toBe(false);
    expect(
      MarketplaceConfigSchema.safeParse({ ...valid, enquiryPhone: '+91 98765 43210' }).success,
    ).toBe(true);
  });
});

// ─── Product schema ──────────────────────────────────────────────────

const minimalProduct = { name: 'Kashmir willow bat', category: 'BAT', price: 1500 };

describe('ProductInputSchema', () => {
  it('fills every default from a minimal valid input', () => {
    const parsed = ProductInputSchema.parse(minimalProduct);
    expect(parsed).toEqual({
      name: 'Kashmir willow bat',
      category: 'BAT',
      brand: null,
      sku: null,
      description: null,
      price: 1500,
      mrp: null,
      stockQty: null,
      inStock: true,
      isActive: false,
      isFeatured: false,
      displayOrder: 0,
      sizes: [],
      specs: [],
    });
  });

  it('turns an empty brand / sku / description into null, and trims the rest', () => {
    const parsed = ProductInputSchema.parse({
      ...minimalProduct,
      brand: '',
      sku: '   ',
      description: '  Hand-made  ',
    });
    expect(parsed.brand).toBeNull();
    expect(parsed.sku).toBeNull();
    expect(parsed.description).toBe('Hand-made');
  });

  it('rejects an MRP below the selling price with the MRP message', () => {
    const parsed = ProductInputSchema.safeParse({ ...minimalProduct, mrp: 1000 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === 'mrp');
      expect(issue?.message).toBe('MRP cannot be lower than the selling price');
    }
  });

  it('accepts an MRP equal to or above the price, and null for none', () => {
    expect(ProductInputSchema.safeParse({ ...minimalProduct, mrp: 1500 }).success).toBe(true);
    expect(ProductInputSchema.safeParse({ ...minimalProduct, mrp: 2000 }).success).toBe(true);
    expect(ProductInputSchema.parse({ ...minimalProduct, mrp: null }).mrp).toBeNull();
  });

  it('rejects stock 0 with "in stock" ticked — the flag is what the shop renders', () => {
    const parsed = ProductInputSchema.safeParse({ ...minimalProduct, stockQty: 0, inStock: true });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === 'inStock');
      expect(issue?.message).toMatch(/Stock is 0/);
    }
  });

  it('accepts stock 0 once "in stock" is unticked', () => {
    expect(
      ProductInputSchema.safeParse({ ...minimalProduct, stockQty: 0, inStock: false }).success,
    ).toBe(true);
  });

  it('rejects a negative or fractional stock quantity', () => {
    expect(ProductInputSchema.safeParse({ ...minimalProduct, stockQty: -1 }).success).toBe(false);
    expect(ProductInputSchema.safeParse({ ...minimalProduct, stockQty: 2.5 }).success).toBe(false);
  });

  it('de-duplicates sizes case-insensitively, keeping the first spelling', () => {
    const parsed = ProductInputSchema.parse({
      ...minimalProduct,
      sizes: ['SH', 'sh', ' Harrow ', 'HARROW', 'Men’s L'],
    });
    expect(parsed.sizes).toEqual(['SH', 'Harrow', 'Men’s L']);
  });

  it('caps sizes at the limit', () => {
    const sizes = Array.from({ length: MARKETPLACE_LIMITS.sizes + 1 }, (_, i) => `S${i}`);
    const parsed = ProductInputSchema.safeParse({ ...minimalProduct, sizes });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(`At most ${MARKETPLACE_LIMITS.sizes} sizes`);
    }
    expect(
      ProductInputSchema.safeParse({ ...minimalProduct, sizes: sizes.slice(0, MARKETPLACE_LIMITS.sizes) })
        .success,
    ).toBe(true);
  });

  it('caps specs at the limit and requires both label and value', () => {
    const specs = Array.from({ length: MARKETPLACE_LIMITS.specs + 1 }, (_, i) => ({
      label: `Spec ${i}`,
      value: `Value ${i}`,
    }));
    expect(ProductInputSchema.safeParse({ ...minimalProduct, specs }).success).toBe(false);
    expect(
      ProductInputSchema.safeParse({ ...minimalProduct, specs: specs.slice(0, MARKETPLACE_LIMITS.specs) })
        .success,
    ).toBe(true);
    expect(
      ProductInputSchema.safeParse({ ...minimalProduct, specs: [{ label: 'Weight', value: '' }] })
        .success,
    ).toBe(false);
  });

  it('rejects a category outside the catalog', () => {
    const parsed = ProductInputSchema.safeParse({ ...minimalProduct, category: 'HELICOPTER' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('Pick a category');
  });

  it('rejects a price of zero, negative, missing or unrealistically high', () => {
    expect(ProductInputSchema.safeParse({ ...minimalProduct, price: 0 }).success).toBe(false);
    expect(ProductInputSchema.safeParse({ ...minimalProduct, price: -5 }).success).toBe(false);
    expect(ProductInputSchema.safeParse({ name: 'Bat', category: 'BAT' }).success).toBe(false);
    expect(
      ProductInputSchema.safeParse({ ...minimalProduct, price: MARKETPLACE_LIMITS.maxPrice + 1 })
        .success,
    ).toBe(false);
  });

  it('requires a name of at least two characters', () => {
    expect(ProductInputSchema.safeParse({ ...minimalProduct, name: ' B ' }).success).toBe(false);
  });
});

describe('parseProductSpecs', () => {
  it('returns an empty list for anything that is not an array', () => {
    for (const raw of [null, undefined, 'specs', 7, { label: 'a', value: 'b' }]) {
      expect(parseProductSpecs(raw)).toEqual([]);
    }
  });

  it('keeps only rows with both a label and a value, trimmed', () => {
    expect(
      parseProductSpecs([
        { label: ' Willow ', value: ' English ' },
        { label: 'Weight' },
        { value: '1.2 kg' },
        { label: '', value: 'x' },
        null,
        'junk',
        { label: 'Grains', value: 8 },
      ]),
    ).toEqual([
      { label: 'Willow', value: 'English' },
      { label: 'Grains', value: '8' },
    ]);
  });

  it('caps the list at the spec limit', () => {
    const raw = Array.from({ length: MARKETPLACE_LIMITS.specs + 5 }, (_, i) => ({
      label: `L${i}`,
      value: `V${i}`,
    }));
    expect(parseProductSpecs(raw)).toHaveLength(MARKETPLACE_LIMITS.specs);
  });
});

// ─── Small pure helpers ──────────────────────────────────────────────

describe('discountPercent', () => {
  it('reports the whole-percent saving against the MRP', () => {
    expect(discountPercent(2000, 1500)).toBe(25);
    expect(discountPercent(999, 899)).toBe(10);
  });

  it('is null when the MRP equals the price — nothing is saved', () => {
    expect(discountPercent(1500, 1500)).toBeNull();
  });

  it('is null when the MRP is missing or below the price', () => {
    expect(discountPercent(null, 1500)).toBeNull();
    expect(discountPercent(undefined, 1500)).toBeNull();
    expect(discountPercent(1000, 1500)).toBeNull();
  });

  it('is null when the saving rounds to zero', () => {
    expect(discountPercent(100000, 99999)).toBeNull();
  });
});

describe('toWhatsAppDigits', () => {
  it('prefixes a bare 10-digit Indian mobile with 91', () => {
    expect(toWhatsAppDigits('9876543210')).toBe('919876543210');
  });

  it('accepts the formatted, country-coded and 0-91 international spellings', () => {
    expect(toWhatsAppDigits('+91 98765 43210')).toBe('919876543210');
    expect(toWhatsAppDigits('919876543210')).toBe('919876543210');
    expect(toWhatsAppDigits('0919876543210')).toBe('919876543210');
  });

  it('rejects short numbers, landlines and non-mobile prefixes rather than guessing', () => {
    expect(toWhatsAppDigits('12345')).toBeNull();
    expect(toWhatsAppDigits('022 1234 5678')).toBeNull();
    expect(toWhatsAppDigits('5876543210')).toBeNull();
  });

  it('accepts the trunk-prefixed "0 + mobile" form, like normalizeIndianMobile', () => {
    // An admin can type the enquiry number the same way they would type an
    // address phone; the trunk 0 is dropped and 91 prefixed.
    expect(toWhatsAppDigits('09876543210')).toBe('919876543210');
  });

  it('is null for a missing value', () => {
    expect(toWhatsAppDigits(null)).toBeNull();
    expect(toWhatsAppDigits(undefined)).toBeNull();
    expect(toWhatsAppDigits('')).toBeNull();
  });
});

describe('buildWhatsAppLink', () => {
  it('builds a click-to-chat link with the message URL-encoded', () => {
    const link = buildWhatsAppLink('9876543210', 'Hi PlayOrbit,\nI want a bat & pads');
    expect(link).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent('Hi PlayOrbit,\nI want a bat & pads')}`,
    );
    expect(link).toContain('%0A');
    expect(link).toContain('%26');
    expect(link).not.toContain('\n');
  });

  it('returns null without a usable phone', () => {
    expect(buildWhatsAppLink(null, 'hello')).toBeNull();
    expect(buildWhatsAppLink('', 'hello')).toBeNull();
    expect(buildWhatsAppLink('12345', 'hello')).toBeNull();
  });
});

describe('buildEnquiryMessage', () => {
  const product = { name: 'Player Edition', brand: 'SG', price: 12500 };
  const address = ['Rahul', '12 MG Road', 'Pune, Maharashtra 411001', 'Phone: 9876543210'];

  it('uses the "interested" wording while coming soon and never asks for quantity or delivery', () => {
    const text = buildEnquiryMessage({
      product,
      size: 'SH',
      quantity: 2,
      addressLines: address,
      productUrl: 'https://playorbit.in/shop/p1',
      comingSoon: true,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe("Hi PlayOrbit, I'm interested in this product from your store:");
    expect(lines[1]).toBe('• Player Edition (SG) — ₹12,500');
    expect(lines).toContain('Size: SH');
    expect(text).not.toContain('Qty:');
    expect(text).not.toContain('Deliver to:');
    expect(text).not.toContain('12 MG Road');
    expect(lines[lines.length - 1]).toBe('https://playorbit.in/shop/p1');
  });

  it('uses the order wording once open, with quantity and the delivery address', () => {
    const text = buildEnquiryMessage({
      product,
      size: 'SH',
      quantity: 2,
      addressLines: address,
      productUrl: 'https://playorbit.in/shop/p1',
      comingSoon: false,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe("Hi PlayOrbit, I'd like to order this from your store:");
    expect(lines).toContain('Qty: 2');
    const deliverAt = lines.indexOf('Deliver to:');
    expect(deliverAt).toBeGreaterThan(0);
    expect(lines.slice(deliverAt + 1, deliverAt + 1 + address.length)).toEqual(address);
    expect(lines[lines.length - 1]).toBe('https://playorbit.in/shop/p1');
  });

  it('omits the size, address and URL lines when they are not supplied', () => {
    const text = buildEnquiryMessage({
      product: { name: 'Tennis ball (pack of 6)', brand: null, price: 450 },
      comingSoon: false,
    });
    expect(text).toBe(
      ["Hi PlayOrbit, I'd like to order this from your store:", '• Tennis ball (pack of 6) — ₹450', 'Qty: 1'].join(
        '\n',
      ),
    );
  });

  it('never sends a quantity below one or a fractional one', () => {
    expect(buildEnquiryMessage({ product, quantity: 0, comingSoon: false })).toContain('Qty: 1');
    expect(buildEnquiryMessage({ product, quantity: 2.7, comingSoon: false })).toContain('Qty: 2');
  });
});

describe('formatRupees', () => {
  it('formats with the rupee sign and Indian grouping', () => {
    expect(formatRupees(1500)).toBe('₹1,500');
    expect(formatRupees(150000)).toBe('₹1,50,000');
    expect(formatRupees(449.6)).toBe('₹450');
  });
});

describe('stockLabel', () => {
  it('reads "Out of stock" when unticked or when a tracked stock hits zero', () => {
    expect(stockLabel({ inStock: false, stockQty: null })).toEqual({ text: 'Out of stock', tone: 'out' });
    expect(stockLabel({ inStock: false, stockQty: 10 })).toEqual({ text: 'Out of stock', tone: 'out' });
    expect(stockLabel({ inStock: true, stockQty: 0 })).toEqual({ text: 'Out of stock', tone: 'out' });
  });

  it('warns when three or fewer are left', () => {
    expect(stockLabel({ inStock: true, stockQty: 3 })).toEqual({ text: 'Only 3 left', tone: 'low' });
    expect(stockLabel({ inStock: true, stockQty: 1 })).toEqual({ text: 'Only 1 left', tone: 'low' });
  });

  it('reads "In stock" for untracked stock or a healthy quantity', () => {
    expect(stockLabel({ inStock: true, stockQty: null })).toEqual({ text: 'In stock', tone: 'ok' });
    expect(stockLabel({ inStock: true, stockQty: 4 })).toEqual({ text: 'In stock', tone: 'ok' });
  });
});

// ─── Upload validation ───────────────────────────────────────────────

const JPEG_SOI = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** "RIFF" + size + "WEBP" — the 12-byte container header. */
function riffWebpHeader(): number[] {
  return [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
}

/** PNG signature + IHDR chunk carrying the given dimensions. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** SOI + an APP0 segment + SOF0 carrying the given dimensions. */
function jpegHeader(width: number, height: number): Uint8Array {
  const app0Payload = 14; // JFIF header body
  const sof0Payload = 15; // precision + height + width + 3 components
  const bytes = new Uint8Array(2 + 2 + 2 + app0Payload + 2 + 2 + sof0Payload);
  const view = new DataView(bytes.buffer);
  let o = 0;
  bytes.set([0xff, 0xd8], o);
  o += 2;
  bytes.set([0xff, 0xe0], o);
  view.setUint16(o + 2, 2 + app0Payload);
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00], o + 4); // "JFIF\0"
  o += 2 + 2 + app0Payload;
  bytes.set([0xff, 0xc0], o);
  view.setUint16(o + 2, 2 + sof0Payload);
  bytes[o + 4] = 8; // precision
  view.setUint16(o + 5, height);
  view.setUint16(o + 7, width);
  bytes[o + 9] = 3; // components
  return bytes;
}

/** RIFF/WEBP + a VP8L chunk whose 14-bit fields encode width-1 / height-1. */
function webpLosslessHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(riffWebpHeader(), 0);
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes[20] = 0x2f; // VP8L signature
  const w = width - 1;
  const h = height - 1;
  bytes[21] = w & 0xff;
  bytes[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  bytes[23] = (h >> 2) & 0xff;
  bytes[24] = (h >> 10) & 0x0f;
  return bytes;
}

describe('sniffImageType', () => {
  it('recognises JPEG, PNG and WebP from their first bytes', () => {
    expect(sniffImageType(new Uint8Array([...JPEG_SOI, ...new Array(20).fill(0)]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([...PNG_SIGNATURE, ...new Array(20).fill(0)]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([...riffWebpHeader(), ...new Array(20).fill(0)]))).toBe('image/webp');
  });

  it('rejects garbage, a RIFF that is not WebP, and anything shorter than 12 bytes', () => {
    expect(sniffImageType(new Uint8Array(64))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('GIF89a' + '\0'.repeat(20)))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('MZ' + '\0'.repeat(30)))).toBeNull();
    // "RIFF....WAVE" is a valid RIFF container but not an image.
    expect(
      sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WAVE' + '\0'.repeat(20))),
    ).toBeNull();
    expect(sniffImageType(new Uint8Array(JPEG_SOI))).toBeNull();
  });
});

describe('readImageDimensions', () => {
  it('reads width and height from a PNG IHDR', () => {
    const bytes = pngHeader(640, 480);
    expect(sniffImageType(bytes)).toBe('image/png');
    expect(readImageDimensions(bytes, 'image/png')).toEqual({ width: 640, height: 480 });
  });

  it('walks past APP0 to the SOF0 segment of a JPEG', () => {
    const bytes = jpegHeader(640, 480);
    expect(sniffImageType(bytes)).toBe('image/jpeg');
    expect(readImageDimensions(bytes, 'image/jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('decodes the packed 14-bit fields of a lossless WebP (VP8L) header', () => {
    const bytes = webpLosslessHeader(640, 480);
    expect(sniffImageType(bytes)).toBe('image/webp');
    expect(readImageDimensions(bytes, 'image/webp')).toEqual({ width: 640, height: 480 });
    expect(readImageDimensions(webpLosslessHeader(1, 1), 'image/webp')).toEqual({ width: 1, height: 1 });
  });

  it('returns null rather than guessing when the header is truncated or has no frame', () => {
    expect(readImageDimensions(new Uint8Array(PNG_SIGNATURE), 'image/png')).toBeNull();
    // A JPEG that reaches start-of-scan without ever declaring a frame.
    const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, ...new Array(12).fill(0)]);
    expect(readImageDimensions(noFrame, 'image/jpeg')).toBeNull();
    const unknownChunk = new Uint8Array(32);
    unknownChunk.set(riffWebpHeader(), 0);
    unknownChunk.set([0x41, 0x4c, 0x50, 0x48], 12); // "ALPH"
    expect(readImageDimensions(unknownChunk, 'image/webp')).toBeNull();
  });
});

// ─── Catalog parity ──────────────────────────────────────────────────

describe('MARKETPLACE_CATEGORIES', () => {
  it('gives every category a unique code, a label, a blurb and an icon', () => {
    // The icon map lives with the components (it imports lucide); the
    // catalog lives in the pure lib. A category added to one without the
    // other would render a bare placeholder, so pin the parity here.
    const values = MARKETPLACE_CATEGORIES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
    for (const c of MARKETPLACE_CATEGORIES) {
      expect(c.label, `label for ${c.value}`).toBeTruthy();
      expect(c.blurb, `blurb for ${c.value}`).toBeTruthy();
      expect(CATEGORY_ICONS[c.value], `icon for ${c.value}`).toBeTruthy();
    }
    expect(Object.keys(CATEGORY_ICONS).sort()).toEqual([...values].sort());
  });

  it('exposes the ids in catalog order for the Zod enum', () => {
    expect([...MARKETPLACE_CATEGORY_IDS]).toEqual(MARKETPLACE_CATEGORIES.map((c) => c.value));
    expect(isMarketplaceCategory('BAT')).toBe(true);
    expect(isMarketplaceCategory('bat')).toBe(false);
    expect(isMarketplaceCategory(null)).toBe(false);
  });

  it('labels a known code and falls back to the code itself', () => {
    expect(marketplaceCategoryLabel('BAT')).toBe('Cricket Bats');
    expect(marketplaceCategoryLabel('HELICOPTER')).toBe('HELICOPTER');
    expect(marketplaceCategoryLabel(null)).toBe('Uncategorised');
    expect(marketplaceCategoryLabel('')).toBe('Uncategorised');
  });
});
