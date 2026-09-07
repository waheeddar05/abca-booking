import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRODUCTION_ORIGIN, siteOrigin } from '../site-url';

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_URL', 'PORT'] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('siteOrigin — the absolute base for share images', () => {
  it('prefers an explicit NEXT_PUBLIC_SITE_URL over everything else', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://staging.playorbit.in';
    process.env.VERCEL_ENV = 'production';
    expect(siteOrigin().origin).toBe('https://staging.playorbit.in');
  });

  it('ignores a malformed override and falls through', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url';
    process.env.VERCEL_ENV = 'production';
    expect(siteOrigin().origin).toBe(PRODUCTION_ORIGIN);
  });

  it('is the www domain on Vercel production, whatever the git ref', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    process.env.VERCEL_URL = 'playorbit-abc123-waheeddar05s-projects.vercel.app';
    expect(siteOrigin().origin).toBe('https://www.playorbit.in');
  });

  it('is the test domain for the test-branch preview, not its protected vercel.app URL', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_REF = 'test';
    process.env.VERCEL_URL = 'playorbit-abc123-waheeddar05s-projects.vercel.app';
    expect(siteOrigin().origin).toBe('https://test.playorbit.in');
  });

  it('uses the Vercel URL for any other preview branch', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_REF = 'claude/some-feature';
    process.env.VERCEL_URL = 'playorbit-abc123-waheeddar05s-projects.vercel.app';
    expect(siteOrigin().origin).toBe('https://playorbit-abc123-waheeddar05s-projects.vercel.app');
  });

  it('is localhost with the dev port when nothing else is set', () => {
    process.env.PORT = '4000';
    expect(siteOrigin().origin).toBe('http://localhost:4000');
    delete process.env.PORT;
    expect(siteOrigin().origin).toBe('http://localhost:3000');
  });

  it('resolves the share image to an absolute URL under the origin', () => {
    process.env.VERCEL_ENV = 'production';
    expect(new URL('/images/og-cover.jpg', siteOrigin()).href).toBe('https://www.playorbit.in/images/og-cover.jpg');
  });
});
