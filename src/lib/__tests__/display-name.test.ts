/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { isMissingDisplayName, normalizeDisplayName } from '@/lib/display-name';

describe('normalizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Waheed   Akbar  ')).toEqual({ ok: true, value: 'Waheed Akbar' });
  });

  it('accepts non-Latin scripts and ordinary punctuation', () => {
    for (const name of ['वहीद', "D'Souza", 'Jean-Luc', 'M S Dhoni']) {
      expect(normalizeDisplayName(name).ok, name).toBe(true);
    }
  });

  it('rejects empty, whitespace-only and one-character input', () => {
    for (const value of ['', '   ', 'A', null, undefined]) {
      expect(normalizeDisplayName(value).ok).toBe(false);
    }
  });

  it('rejects input with no letters in it', () => {
    expect(normalizeDisplayName('12345').ok).toBe(false);
    expect(normalizeDisplayName('!!! ???').ok).toBe(false);
  });

  it('rejects names past the column limit', () => {
    expect(normalizeDisplayName('a'.repeat(61)).ok).toBe(false);
    expect(normalizeDisplayName('a'.repeat(60)).ok).toBe(true);
  });
});

describe('isMissingDisplayName', () => {
  it('treats null, empty and whitespace-only as missing', () => {
    expect(isMissingDisplayName(null)).toBe(true);
    expect(isMissingDisplayName(undefined)).toBe(true);
    expect(isMissingDisplayName('')).toBe(true);
    expect(isMissingDisplayName('   ')).toBe(true);
  });

  it('treats a real name as present', () => {
    expect(isMissingDisplayName('Waheed')).toBe(false);
  });
});
