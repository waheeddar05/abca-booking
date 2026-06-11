import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn();
const deleteManyMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    policy: {
      upsert: (args: unknown) => upsertMock(args),
      deleteMany: (args: unknown) => deleteManyMock(args),
      findUnique: (args: unknown) => findUniqueMock(args),
    },
  },
}));

import {
  normalizeTo10Digits,
  markWhatsAppUndeliverable,
  clearWhatsAppUndeliverable,
  isWhatsAppUndeliverable,
} from '../whatsapp-deliverability';

beforeEach(() => {
  upsertMock.mockReset().mockResolvedValue({});
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 });
  findUniqueMock.mockReset().mockResolvedValue(null);
});

describe('normalizeTo10Digits', () => {
  it('strips 91 prefix from 12-digit numbers', () => {
    expect(normalizeTo10Digits('918975181837')).toBe('8975181837');
  });

  it('keeps 10-digit numbers as-is', () => {
    expect(normalizeTo10Digits('8975181837')).toBe('8975181837');
  });

  it('strips formatting characters', () => {
    expect(normalizeTo10Digits('+91 89751-81837')).toBe('8975181837');
  });
});

describe('markWhatsAppUndeliverable', () => {
  it('upserts a WA_UNDELIVERABLE_ key with timestamp and code', async () => {
    await markWhatsAppUndeliverable('918975181837', 131026);

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0][0];
    expect(args.where.key).toBe('WA_UNDELIVERABLE_8975181837');
    const value = JSON.parse(args.create.value);
    expect(value.code).toBe(131026);
    expect(Date.parse(value.at)).not.toBeNaN();
  });

  it('ignores invalid numbers', async () => {
    await markWhatsAppUndeliverable('12345');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('swallows DB errors', async () => {
    upsertMock.mockRejectedValue(new Error('db down'));
    await expect(markWhatsAppUndeliverable('8975181837', 131026)).resolves.toBeUndefined();
  });
});

describe('clearWhatsAppUndeliverable', () => {
  it('deletes the flag for the normalized number', async () => {
    await clearWhatsAppUndeliverable('918975181837');
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { key: 'WA_UNDELIVERABLE_8975181837' },
    });
  });

  it('swallows DB errors', async () => {
    deleteManyMock.mockRejectedValue(new Error('db down'));
    await expect(clearWhatsAppUndeliverable('8975181837')).resolves.toBeUndefined();
  });
});

describe('isWhatsAppUndeliverable', () => {
  it('returns false when no flag exists', async () => {
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });

  it('returns true for a fresh flag', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: JSON.stringify({ at: new Date().toISOString(), code: 131026 }),
    });
    expect(await isWhatsAppUndeliverable('918975181837')).toBe(true);
  });

  it('returns false for a stale flag (>7 days)', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: JSON.stringify({ at: eightDaysAgo, code: 131026 }),
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });

  it('tolerates a plain ISO timestamp value', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: new Date().toISOString(),
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(true);
  });

  it('returns false on unparseable values', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: 'garbage',
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });

  it('returns false on DB errors', async () => {
    findUniqueMock.mockRejectedValue(new Error('db down'));
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });
});
