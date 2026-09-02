import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// WhatsApp OTP is the only way into PlayOrbit, so these two routes are
// the whole front door: step 1 issues a code, step 2 trades it for the
// session cookie. Driven here with hand-built requests, no DB or BSP.

const userFindUniqueMock = vi.fn();
const userCreateMock = vi.fn();
const userUpdateMock = vi.fn();
const otpCountMock = vi.fn();
const otpCreateMock = vi.fn();
const otpDeleteMock = vi.fn();
const otpUpdateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (args: unknown) => userFindUniqueMock(args),
      create: (args: unknown) => userCreateMock(args),
      update: (args: unknown) => userUpdateMock(args),
    },
    otp: {
      count: (args: unknown) => otpCountMock(args),
      create: (args: unknown) => otpCreateMock(args),
      delete: (args: unknown) => otpDeleteMock(args),
      update: (args: unknown) => otpUpdateMock(args),
    },
    $transaction: (ops: unknown) => transactionMock(ops),
  },
}));

const sendWhatsAppOTPMock = vi.fn();
const sendWhatsAppNotificationMock = vi.fn();
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppOTP: (mobile: string, otp: string) => sendWhatsAppOTPMock(mobile, otp),
  sendWhatsAppNotification: (...a: unknown[]) => sendWhatsAppNotificationMock(...a),
  // Real rule — a bad number must never reach the DB.
  isValidIndianMobile: (m: string) => /^(\+?91)?[6-9]\d{9}$/.test(String(m).replace(/[\s-]/g, '')),
}));

const sendSMSMock = vi.fn();
vi.mock('@/lib/sms', () => ({ sendSMS: (m: string, o: string) => sendSMSMock(m, o) }));

const getCachedPolicyMock = vi.fn();
vi.mock('@/lib/policy-cache', () => ({
  getCachedPolicy: (k: string) => getCachedPolicyMock(k),
}));

vi.mock('@/lib/whatsapp-deliverability', () => ({
  isWhatsAppUndeliverable: vi.fn(async () => false),
  isWhatsAppAccountBlocked: vi.fn(async () => false),
}));

const compareMock = vi.fn();
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async () => 'hashed'),
    compare: (a: string, b: string) => compareMock(a, b),
  },
}));

vi.mock('@/lib/jwt', () => ({ signToken: (p: unknown) => `signed:${JSON.stringify(p)}` }));

import { POST as requestOtp } from '../request/route';
import { POST as verifyOtp } from '../verify/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = (body: unknown) => ({ json: async () => body }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  userFindUniqueMock.mockResolvedValue(null);
  userCreateMock.mockResolvedValue({ id: 'usr_new' });
  otpCountMock.mockResolvedValue(0);
  otpUpdateMock.mockResolvedValue({});
  otpCreateMock.mockResolvedValue({ id: 'otp_1' });
  otpDeleteMock.mockResolvedValue({});
  transactionMock.mockResolvedValue([]);
  getCachedPolicyMock.mockResolvedValue('true');
  sendWhatsAppOTPMock.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  sendWhatsAppNotificationMock.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  sendSMSMock.mockResolvedValue({ success: false, error: 'no sms configured' });
  compareMock.mockResolvedValue(true);
  process.env.WHATSAPP_OTP_TEMPLATE = 'playorbit_otp';
  delete process.env.INITIAL_ADMIN_MOBILE;
});

describe('POST /api/auth/otp/request — step 1', () => {
  it('sends the code over WhatsApp for a valid number', async () => {
    const res = await requestOtp(req({ mobileNumber: '9876543210' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sendWhatsAppOTPMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppOTPMock.mock.calls[0][0]).toBe('9876543210');
    // A 6-digit code, and it is never echoed back to the caller.
    expect(sendWhatsAppOTPMock.mock.calls[0][1]).toMatch(/^\d{6}$/);
    expect(JSON.stringify(body)).not.toContain(sendWhatsAppOTPMock.mock.calls[0][1]);
    expect(body.channel).toBe('WhatsApp');
  });

  it('creates the account on a first-ever login, unverified until the code checks out', async () => {
    await requestOtp(req({ mobileNumber: '9876543210' }));

    expect(userCreateMock).toHaveBeenCalledTimes(1);
    const data = (userCreateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      mobileNumber: '9876543210',
      authProvider: 'WHATSAPP',
      role: 'USER',
      mobileVerified: false,
    });
  });

  it('reuses the existing account for a returning number', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'usr_existing' });

    await requestOtp(req({ mobileNumber: '9876543210' }));

    expect(userCreateMock).not.toHaveBeenCalled();
    expect((otpCreateMock.mock.calls[0][0] as { data: { userId: string } }).data.userId).toBe('usr_existing');
  });

  it('normalizes a +91-prefixed number to the stored 10 digits', async () => {
    await requestOtp(req({ mobileNumber: '+91 98765 43210' }));

    expect((userFindUniqueMock.mock.calls[0][0] as { where: { mobileNumber: string } }).where.mobileNumber)
      .toBe('9876543210');
  });

  it('rejects a non-Indian-mobile before touching the database', async () => {
    const res = await requestOtp(req({ mobileNumber: '12345' }));

    expect(res.status).toBe(400);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(userCreateMock).not.toHaveBeenCalled();
    expect(sendWhatsAppOTPMock).not.toHaveBeenCalled();
  });

  it('rejects a missing number', async () => {
    const res = await requestOtp(req({}));
    expect(res.status).toBe(400);
  });

  it('rate-limits to 3 codes per 10 minutes', async () => {
    userFindUniqueMock.mockResolvedValue({ id: 'usr_1' });
    // First count is the per-account window.
    otpCountMock.mockResolvedValueOnce(3);

    const res = await requestOtp(req({ mobileNumber: '9876543210' }));

    expect(res.status).toBe(429);
    expect(otpCreateMock).not.toHaveBeenCalled();
    expect(sendWhatsAppOTPMock).not.toHaveBeenCalled();
  });

  it('trips the platform-wide breaker so cycling numbers cannot run up the bill', async () => {
    // Per-account window is clear; the global window is not. An attacker
    // cycling fresh numbers never trips the per-account limit, and every
    // call spends real money on a template or an SMS.
    otpCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(30);

    const res = await requestOtp(req({ mobileNumber: '9876543210' }));

    expect(res.status).toBe(429);
    expect(otpCreateMock).not.toHaveBeenCalled();
    expect(sendWhatsAppOTPMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it('falls back to SMS when WhatsApp cannot deliver', async () => {
    sendWhatsAppOTPMock.mockResolvedValue({ success: false, error: 'template rejected' });
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'nope' });
    sendSMSMock.mockResolvedValue({ success: true, provider: 'fast2sms' });

    const res = await requestOtp(req({ mobileNumber: '9876543210' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.channel).toBe('SMS');
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
  });

  it('rolls the code back when nothing was delivered, so an outage cannot burn the budget', async () => {
    sendWhatsAppOTPMock.mockResolvedValue({ success: false, error: 'down' });
    sendWhatsAppNotificationMock.mockResolvedValue({ success: false, error: 'down' });
    sendSMSMock.mockResolvedValue({ success: false, error: 'down' });

    const res = await requestOtp(req({ mobileNumber: '9876543210' }));

    expect(res.status).toBe(502);
    expect(otpDeleteMock).toHaveBeenCalledWith({ where: { id: 'otp_1' } });
  });

  it('promotes the configured bootstrap number to ADMIN on creation', async () => {
    process.env.INITIAL_ADMIN_MOBILE = '9876543210';

    await requestOtp(req({ mobileNumber: '9876543210' }));

    expect((userCreateMock.mock.calls[0][0] as { data: { role: string } }).data.role).toBe('ADMIN');
  });
});

describe('POST /api/auth/otp/verify — step 2', () => {
  const otpRow = { id: 'otp_1', codeHash: 'hashed' };

  function loginUser(overrides: Record<string, unknown> = {}) {
    return {
      id: 'usr_1',
      name: 'Rahul',
      email: null,
      mobileNumber: '9876543210',
      role: 'USER',
      otps: [{ ...otpRow, attempts: 0 }],
      ...overrides,
    };
  }

  it('sets the session cookie on a correct code', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser());

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get('token');
    expect(cookie?.value).toContain('signed:');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('marks the account mobile-verified — receiving the code proves the number', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser());

    await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    // Both writes go in one transaction: a used code must never leave the
    // account unverified.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const update = (userUpdateMock.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(update).toMatchObject({ mobileVerified: true, phonePromptDismissed: true });
  });

  it('carries the role on the token so middleware can gate /admin', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser({ role: 'MODERATOR' }));

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    const cookie = res.cookies.get('token');
    expect(cookie?.value).toContain('"role":"MODERATOR"');
    expect(cookie?.value).toContain('"mobileVerified":true');
  });

  it('normalizes a +91-prefixed number to find the account', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser());

    await verifyOtp(req({ mobileNumber: '+919876543210', otp: '123456' }));

    expect((userFindUniqueMock.mock.calls[0][0] as { where: { mobileNumber: string } }).where.mobileNumber)
      .toBe('9876543210');
  });

  it('rejects a wrong code without creating a session, and counts the miss', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser());
    compareMock.mockResolvedValue(false);

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '000000' }));

    expect(res.status).toBe(400);
    expect(res.cookies.get('token')).toBeUndefined();
    expect(transactionMock).not.toHaveBeenCalled();
    expect((otpUpdateMock.mock.calls[0][0] as { data: { attempts: number; used: boolean } }).data)
      .toEqual({ attempts: 1, used: false });
  });

  it('burns the code on the last allowed miss instead of leaving it live', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser({ otps: [{ ...otpRow, attempts: 4 }] }));
    compareMock.mockResolvedValue(false);

    await verifyOtp(req({ mobileNumber: '9876543210', otp: '000000' }));

    expect((otpUpdateMock.mock.calls[0][0] as { data: { attempts: number; used: boolean } }).data)
      .toEqual({ attempts: 5, used: true });
  });

  it('refuses a code that is already past the attempt cap — 6 digits are brute-forceable', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser({ otps: [{ ...otpRow, attempts: 5 }] }));

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    expect(res.status).toBe(429);
    expect(res.cookies.get('token')).toBeUndefined();
    // Never even compares — a correct guess at this point must not pass.
    expect(compareMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rejects when no unused, unexpired code is outstanding', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser({ otps: [] }));

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    expect(res.status).toBe(400);
    expect(res.cookies.get('token')).toBeUndefined();
  });

  it('rejects an unknown number', async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const res = await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    expect(res.status).toBe(400);
  });

  it('only considers codes that are unused and unexpired', async () => {
    userFindUniqueMock.mockResolvedValue(loginUser());

    await verifyOtp(req({ mobileNumber: '9876543210', otp: '123456' }));

    const include = (userFindUniqueMock.mock.calls[0][0] as {
      include: { otps: { where: Record<string, unknown> } };
    }).include;
    expect(include.otps.where).toMatchObject({ used: false });
    expect(include.otps.where).toHaveProperty('expiresAt');
  });
});
