/**
 * @vitest-environment node
 *
 * "Log in, close the app, reopen it" must land on the booking screen.
 *
 * Two things used to defeat that and neither is reachable from a component
 * test, so they are pinned here against the shipped files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');

describe('installed app launch target', () => {
  it('opens the booking screen, not the marketing page', () => {
    // Signed out, middleware sends /slots back to / and the landing page
    // renders — so this is the right target for both states.
    expect(manifest.start_url).toBe('/slots');
  });

  it('keeps its identity so existing installs update in place', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
  });
});

describe('service worker', () => {
  it('never handles navigations', () => {
    // Every document this app serves depends on who is asking. Caching one
    // and replaying it to the same browser in a different auth state is how
    // a signed-in user ends up looking at the landing page.
    expect(sw).toMatch(/if \(request\.mode === 'navigate'\) return;/);
  });

  it('has no page-caching branch left', () => {
    expect(sw).not.toMatch(/response\.ok && !response\.redirected/);
  });

  it('bumped the cache name so the old cached documents are dropped', () => {
    // The activate handler deletes every cache whose key isn't CACHE_NAME,
    // so the bump is what evicts documents cached by the previous version.
    const match = sw.match(/const CACHE_NAME = 'playorbit-v(\d+)';/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(8);
  });
});
