/**
 * @vitest-environment node
 *
 * Guards the import graph of `src/middleware.ts`.
 *
 * Middleware runs in Vercel's Edge Runtime, which has Web Crypto but none of
 * Node's built-ins. Turbopack does not fail the build on that: it replaces
 * `crypto` with a stub that throws only when something touches it, so an
 * edge-unsafe import ships happily and then fails per-request in production.
 *
 * That is exactly how the 2026-09-02 login outage happened — middleware
 * imported `@/lib/jwt`, which imported `jsonwebtoken`, which reaches
 * `crypto.createHmac`. Every session check threw, was caught into "not signed
 * in", and every logged-in user ping-ponged between `/` and `/slots` forever.
 *
 * Unit tests run in Node, where such an import works fine, so no ordinary test
 * can catch this. Hence a static check: everything middleware pulls in must be
 * on the edge-safe list below. Adding to that list is a deliberate act — verify
 * the package works on the edge (Web Crypto / fetch only) before you do.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const ENTRY = path.join(SRC, 'middleware.ts');

/** Third-party modules confirmed to run in the Edge Runtime. */
const EDGE_SAFE_PACKAGES = new Set([
  'next/server',
  'next-auth/jwt',
  'jose',
]);

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith('@/')
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? path.resolve(path.dirname(fromFile), spec)
      : null;
  if (!base) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && !existsSync(path.join(candidate, '.'))) return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every bare package specifier reachable from `entry` through local files. */
function collectPackageImports(entry: string): Map<string, string[]> {
  const packages = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file) || !/\.tsx?$/.test(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(IMPORT_RE)) {
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const resolved = resolveLocal(spec, file);
        if (resolved) queue.push(resolved);
        continue;
      }
      // Ignore type-only style imports of CSS/assets; everything else counts.
      if (/\.(css|scss|png|svg|jpg)$/.test(spec)) continue;
      packages.set(spec, [...(packages.get(spec) ?? []), path.relative(SRC, file)]);
    }
  }

  return packages;
}

describe('middleware edge safety', () => {
  it('pulls in only packages known to work in the Edge Runtime', () => {
    const offenders = [...collectPackageImports(ENTRY).entries()]
      .filter(([spec]) => !EDGE_SAFE_PACKAGES.has(spec))
      .map(([spec, importers]) => `${spec} (imported by ${importers.join(', ')})`);

    expect(
      offenders,
      'These reach middleware but are not on the edge-safe list. Confirm the ' +
        'package runs in the Edge Runtime (Web Crypto and fetch only, no Node ' +
        'built-ins), then add it to EDGE_SAFE_PACKAGES.',
    ).toEqual([]);
  });

  it('does not reach jsonwebtoken, which needs node:crypto', () => {
    expect([...collectPackageImports(ENTRY).keys()]).not.toContain('jsonwebtoken');
  });
});
