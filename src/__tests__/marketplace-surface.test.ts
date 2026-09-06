/**
 * @vitest-environment node
 *
 * The marketplace's edges — what the middleware lets through, what it
 * keeps moderators out of, and the tables it stands on — are not
 * reachable from a component or route test, so they are pinned here
 * against the shipped files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const middleware = readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  path.join(root, 'prisma/migrations/20260905120000_marketplace_and_addresses/migration.sql'),
  'utf8',
);

/** The `const isPublicPath = …;` expression, so a match can't come from elsewhere. */
function publicPathBlock(): string {
  const start = middleware.indexOf('const isPublicPath =');
  expect(start).toBeGreaterThan(-1);
  const end = middleware.indexOf(';', start);
  return middleware.slice(start, end);
}

/** A Prisma model block, `model X {` through the closing brace at column 0. */
function modelBody(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  expect(start, `model ${name}`).toBeGreaterThan(-1);
  // Prisma formats the closer on its own line; a `}` can also sit inside
  // a field comment, so don't stop at the first one.
  const end = schema.indexOf('\n}', start);
  return schema.slice(start, end);
}

/** The body of the `moderatorBlockedPrefixes = [ … ]` array literal. */
function moderatorBlockedBlock(): string {
  const start = middleware.indexOf('const moderatorBlockedPrefixes = [');
  expect(start).toBeGreaterThan(-1);
  const end = middleware.indexOf('];', start);
  return middleware.slice(start, end);
}

describe('middleware — the store is public', () => {
  it('lets a signed-out visitor browse /shop and any product page', () => {
    const block = publicPathBlock();
    expect(block).toContain('pathname === "/shop"');
    expect(block).toContain('pathname.startsWith("/shop/")');
  });

  it('lets the catalog API through so the store loads before sign-in', () => {
    // Routes under /api/shop that need a user ("Notify me") check the
    // session themselves and answer a JSON 401 instead of the HTML
    // redirect a protected path would get.
    expect(publicPathBlock()).toContain('pathname.startsWith("/api/shop")');
  });

  it('does not open the admin store or the user address API as a side effect', () => {
    const block = publicPathBlock();
    expect(block).not.toContain('/admin/shop');
    expect(block).not.toContain('/api/admin/shop');
    expect(block).not.toContain('/api/user/addresses');
  });
});

describe('middleware — the Cricket Store is run by store admins', () => {
  it('routes a store admin who holds no admin role to /admin/shop and nowhere else', () => {
    expect(middleware).toContain('const storeAdminClaim = otpToken?.isStoreAdmin === true;');
    expect(middleware).toMatch(/if \(!storeAdminClaim\) \{\s*return NextResponse\.redirect\(new URL\("\/", req\.url\)\);/);
    expect(middleware).toMatch(/if \(!isStorePath\) \{\s*return NextResponse\.redirect\(new URL\("\/admin\/shop", req\.url\)\);/);
  });

  it('turns a role holder without the store grant away from /admin/shop', () => {
    expect(middleware).toContain('isStorePath && claimsKnown && !storeAdminClaim && !superAdminClaim');
  });

  it('lists /admin/shop among the moderator-blocked prefixes', () => {
    expect(moderatorBlockedBlock()).toContain('"/admin/shop"');
  });

  it('blocks the prefix and everything under it', () => {
    // The check is `pathname === p || pathname.startsWith(p + "/")`, so a
    // deep link to /admin/shop/<id> is bounced too.
    expect(middleware).toMatch(
      /moderatorBlockedPrefixes\.some\(\(p\) => pathname === p \|\| pathname\.startsWith\(p \+ "\/"\)\)/,
    );
  });
});

const MARKETPLACE_MODELS = [
  'MarketplaceProduct',
  'MarketplaceProductImage',
  'MarketplaceInterest',
  'UserAddress',
] as const;

describe('schema', () => {
  it.each(MARKETPLACE_MODELS)('declares the %s model', (model) => {
    expect(schema).toMatch(new RegExp(`^model ${model} \\{`, 'm'));
  });

  it('keeps one interest row per user per product', () => {
    expect(modelBody('MarketplaceInterest')).toContain('@@unique([productId, userId])');
  });

  it('cascades images and interests away with their product', () => {
    for (const model of ['MarketplaceProductImage', 'MarketplaceInterest']) {
      expect(modelBody(model), `${model} → product`).toMatch(
        /product\s+MarketplaceProduct\s+@relation\([^)]*onDelete: Cascade/,
      );
    }
  });

  it('does NOT scope products to a center — the store is one catalog for all of PlayOrbit', () => {
    const body = modelBody('MarketplaceProduct');
    expect(body).not.toMatch(/centerId/);
    expect(body).toContain('@@index([isActive, category])');
  });

  it('carries the platform-level store grant on User, next to isSuperAdmin', () => {
    const body = modelBody('User');
    expect(body).toMatch(/^\s+isSuperAdmin\s+Boolean\s+@default\(false\)/m);
    expect(body).toMatch(/^\s+isStoreAdmin\s+Boolean\s+@default\(false\)/m);
  });
});

describe('migration 20260906120000_store_platform_wide', () => {
  const followUp = readFileSync(
    path.join(root, 'prisma/migrations/20260906120000_store_platform_wide/migration.sql'),
    'utf8',
  );

  it('drops the center column from products and adds the store grant to users', () => {
    expect(followUp).toContain('ALTER TABLE "MarketplaceProduct" DROP COLUMN IF EXISTS "centerId"');
    expect(followUp).toContain('DROP CONSTRAINT IF EXISTS "MarketplaceProduct_centerId_fkey"');
    expect(followUp).toContain('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isStoreAdmin" BOOLEAN NOT NULL DEFAULT false');
    expect(followUp).toContain('CREATE INDEX IF NOT EXISTS "MarketplaceProduct_isActive_category_idx"');
  });

  it('touches nothing but the store tables and the user flag', () => {
    const altered = followUp.match(/^ALTER TABLE "(\w+)"/gm) ?? [];
    for (const line of altered) {
      const table = line.match(/"(\w+)"/)?.[1] ?? '';
      expect(['MarketplaceProduct', 'User'], line).toContain(table);
    }
    expect(followUp).not.toMatch(/^\s*DROP TABLE/m);
  });
});

describe('migration 20260905120000_marketplace_and_addresses', () => {
  it.each(MARKETPLACE_MODELS)('creates the %s table', (model) => {
    expect(migration).toContain(`CREATE TABLE "${model}" (`);
  });

  it('is purely additive — no existing table is altered or dropped', () => {
    expect(migration).not.toMatch(/^\s*DROP TABLE/m);
    const altered = migration.match(/^ALTER TABLE "(\w+)"/gm) ?? [];
    for (const line of altered) {
      const table = line.match(/"(\w+)"/)?.[1] ?? '';
      expect(MARKETPLACE_MODELS as readonly string[], line).toContain(table);
    }
  });
});
