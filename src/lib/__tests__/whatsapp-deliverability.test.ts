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
  isUnreachableErrorCode,
  isAccountBlockedErrorCode,
  extractErrorCodes,
  classifyFailedStatus,
  markWhatsAppAccountBlocked,
  clearWhatsAppAccountBlocked,
  isWhatsAppAccountBlocked,
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

  // Regression: flagging on any `failed` status locked reachable users
  // out of the OTP flow for 7 days.
  it.each([
    ['re-engagement / 24h window', 131047],
    ['legacy re-engagement', 470],
    ['per-user pacing', 131049],
    ['user opted out', 131050],
    ['experiment bucket', 130472],
    ['template param mismatch', 132000],
    ['rate limit', 130429],
  ])('does not flag on %s (%i)', async (_label, code) => {
    await markWhatsAppUndeliverable('8975181837', code as number);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('does not flag when no error code is available', async () => {
    await markWhatsAppUndeliverable('8975181837');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('swallows DB errors', async () => {
    upsertMock.mockRejectedValue(new Error('db down'));
    await expect(markWhatsAppUndeliverable('8975181837', 131026)).resolves.toBeUndefined();
  });
});

describe('isUnreachableErrorCode', () => {
  it('accepts only 131026', () => {
    expect(isUnreachableErrorCode(131026)).toBe(true);
    expect(isUnreachableErrorCode(131047)).toBe(false);
    expect(isUnreachableErrorCode(131049)).toBe(false);
    expect(isUnreachableErrorCode(undefined)).toBe(false);
    expect(isUnreachableErrorCode('131026')).toBe(false);
  });
});

describe('extractErrorCodes', () => {
  it('reads codes from every error entry, not just the first', () => {
    expect(
      extractErrorCodes([{ code: 131049 }, { code: 131026, title: 'Undeliverable' }]),
    ).toEqual([131049, 131026]);
  });

  it('reads a nested error_data code', () => {
    expect(extractErrorCodes([{ error_data: { code: 131026 } }])).toEqual([131026]);
  });

  it('returns an empty list for missing or malformed errors', () => {
    expect(extractErrorCodes(undefined)).toEqual([]);
    expect(extractErrorCodes(null)).toEqual([]);
    expect(extractErrorCodes('boom')).toEqual([]);
    expect(extractErrorCodes([null, { code: 'x' }, {}])).toEqual([]);
  });
});

describe('classifyFailedStatus', () => {
  it('flags 131026 as unreachable', () => {
    const r = classifyFailedStatus([{ code: 131026 }]);
    expect(r.unreachableCode).toBe(131026);
    expect(r.isReEngagement).toBe(false);
  });

  it('treats 131047 and 470 as re-engagement, not unreachable', () => {
    for (const code of [131047, 470]) {
      const r = classifyFailedStatus([{ code }]);
      expect(r.isReEngagement).toBe(true);
      expect(r.unreachableCode).toBeUndefined();
    }
  });

  it('leaves unrelated failures unattributed', () => {
    for (const code of [131049, 131050, 130472, 132000, 130429, 133010]) {
      const r = classifyFailedStatus([{ code }]);
      expect(r.isReEngagement).toBe(false);
      expect(r.unreachableCode).toBeUndefined();
    }
  });

  it('finds 131026 even when it is not the first error', () => {
    expect(classifyFailedStatus([{ code: 131049 }, { code: 131026 }]).unreachableCode)
      .toBe(131026);
  });

  it('is inert on an empty errors array', () => {
    expect(classifyFailedStatus([])).toEqual({
      codes: [],
      isReEngagement: false,
      unreachableCode: undefined,
    });
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

  // A legacy plain-ISO value carries no error code, so the failure
  // can't be attributed to the number being off WhatsApp.
  it('ignores a legacy plain ISO timestamp value', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: new Date().toISOString(),
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });

  // Rows written by the previous build from unrelated failure codes stay
  // in the Policy table until they expire — they must stop blocking now.
  it('ignores flags written with a non-unreachable code', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: JSON.stringify({ at: new Date().toISOString(), code: 131049 }),
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
  });

  it('ignores flags with no recorded code', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_UNDELIVERABLE_8975181837',
      value: JSON.stringify({ at: new Date().toISOString(), code: null }),
    });
    expect(await isWhatsAppUndeliverable('8975181837')).toBe(false);
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

// The exact `errors` payload Meta sent to the production webhook on
// 2026-08-13, when the WhatsApp Business account had unsettled billing.
const REAL_131042_ERRORS = [
  {
    code: 131042,
    title: 'Business eligibility payment issue',
    message: 'Business eligibility payment issue',
    error_data: {
      details:
        'Message failed to send because your WhatsApp Business account has unsettled payments.',
    },
    href: 'https://business.facebook.com/billing_hub/accounts/details/',
  },
];

describe('account-level blocks', () => {
  it('recognises payment, lock and policy codes', () => {
    expect(isAccountBlockedErrorCode(131042)).toBe(true);
    expect(isAccountBlockedErrorCode(131031)).toBe(true);
    expect(isAccountBlockedErrorCode(368)).toBe(true);
    expect(isAccountBlockedErrorCode(131026)).toBe(false);
    expect(isAccountBlockedErrorCode(131049)).toBe(false);
    expect(isAccountBlockedErrorCode(undefined)).toBe(false);
  });

  it('classifies the real 131042 payload as account-blocked, not unreachable', () => {
    const r = classifyFailedStatus(REAL_131042_ERRORS);
    expect(r.accountBlockedCode).toBe(131042);
    expect(r.unreachableCode).toBeUndefined();
    expect(r.isReEngagement).toBe(false);
  });

  it('never flags the recipient number for an account-level failure', async () => {
    await markWhatsAppUndeliverable('8975181837', 131042);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('records the block under a single global key', async () => {
    await markWhatsAppAccountBlocked(131042);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0][0];
    expect(args.where.key).toBe('WA_ACCOUNT_BLOCKED');
    expect(JSON.parse(args.create.value).code).toBe(131042);
  });

  it('ignores codes that are not account-level', async () => {
    await markWhatsAppAccountBlocked(131026);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('clears the global key', async () => {
    await clearWhatsAppAccountBlocked();
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { key: 'WA_ACCOUNT_BLOCKED' } });
  });

  it('reports blocked for a fresh flag', async () => {
    findUniqueMock.mockResolvedValue({
      key: 'WA_ACCOUNT_BLOCKED',
      value: JSON.stringify({ at: new Date().toISOString(), code: 131042 }),
    });
    expect(await isWhatsAppAccountBlocked()).toBe(true);
  });

  it('expires after an hour', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    findUniqueMock.mockResolvedValue({
      key: 'WA_ACCOUNT_BLOCKED',
      value: JSON.stringify({ at: twoHoursAgo, code: 131042 }),
    });
    expect(await isWhatsAppAccountBlocked()).toBe(false);
  });

  it('is false when absent, unparseable, or the DB is down', async () => {
    expect(await isWhatsAppAccountBlocked()).toBe(false);
    findUniqueMock.mockResolvedValue({ key: 'WA_ACCOUNT_BLOCKED', value: 'garbage' });
    expect(await isWhatsAppAccountBlocked()).toBe(false);
    findUniqueMock.mockRejectedValue(new Error('db down'));
    expect(await isWhatsAppAccountBlocked()).toBe(false);
  });
});
