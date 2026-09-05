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

describe('middleware — moderators are kept out of Admin → Marketplace', () => {
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

  it('scopes products to a center like every other domain table', () => {
    const body = modelBody('MarketplaceProduct');
    expect(body).toMatch(/^\s+centerId String/m);
    expect(body).toContain('@@index([centerId, isActive, category])');
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
