/**
 * @vitest-environment node
 *
 * PATCH /api/user/profile — the email edit on /profile. WhatsApp login
 * supplies no email, so this is how an account gets (or drops) one; the
 * rules have to hold here and not just in the form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const userUpdateMock = vi.fn();
const userFindUniqueMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      update: (args: unknown) => userUpdateMock(args),
      findUnique: (args: unknown) => userFindUniqueMock(args),
    },
  },
}));

const getAuthenticatedUserMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: (req: unknown) => getAuthenticatedUserMock(req),
}));

import { PATCH } from '../profile/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = (body: unknown) => ({ json: async () => body }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({ id: 'usr_1', isSuperAdmin: false, isStoreAdmin: false });
  // Default: no other account owns the email; the account has a mobile.
  userFindUniqueMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if ('email' in where) return null;
    if ('id' in where) return { mobileNumber: '9876543210' };
    return null;
  });
  userUpdateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'usr_1',
    name: 'Rahul',
    email: data.email ?? null,
    mobileNumber: '9876543210',
    phonePromptDismissed: false,
  }));
});

describe('PATCH /api/user/profile — email', () => {
  it('saves an email, trimmed and lower-cased', async () => {
    const res = await PATCH(req({ email: '  Rahul.Sharma@Example.com ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'rahul.sharma@example.com' });
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'rahul.sharma@example.com' } }),
    );
  });

  it('rejects something that is not an email address', async () => {
    const res = await PATCH(req({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Please enter a valid email address.');
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('answers 409 when another account already uses the email', async () => {
    userFindUniqueMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'email' in where ? { id: 'usr_other' } : { mobileNumber: '9876543210' },
    );

    const res = await PATCH(req({ email: 'taken@example.com' }));

    expect(res.status).toBe(409);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('lets the same account re-save its own email', async () => {
    userFindUniqueMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'email' in where ? { id: 'usr_1' } : { mobileNumber: '9876543210' },
    );

    const res = await PATCH(req({ email: 'mine@example.com' }));

    expect(res.status).toBe(200);
  });

  it('clears the email with an empty string when the account has a mobile number', async () => {
    const res = await PATCH(req({ email: '' }));

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { email: null } }));
  });

  it('refuses to clear the email of an account with no mobile number', async () => {
    userFindUniqueMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'id' in where ? { mobileNumber: null } : null,
    );

    const res = await PATCH(req({ email: '' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Add a mobile number before removing your email.');
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('saves name and email together in one call', async () => {
    const res = await PATCH(req({ name: 'Rahul Sharma', email: 'rahul@example.com' }));

    expect(res.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Rahul Sharma', email: 'rahul@example.com' } }),
    );
  });
});
