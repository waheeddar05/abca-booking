/**
 * @vitest-environment node
 *
 * PATCH /api/user/profile — the endpoint the name prompt writes through.
 * WhatsApp login supplies no name, so this is the only way an account gets
 * one; the validation has to hold here and not just in the form.
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
  getAuthenticatedUserMock.mockResolvedValue({ id: 'usr_1', isSuperAdmin: false });
  userUpdateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'usr_1',
    name: data.name ?? null,
    email: null,
    mobileNumber: '9876543210',
    phonePromptDismissed: false,
  }));
});

describe('PATCH /api/user/profile — name', () => {
  it('saves a name, trimmed and whitespace-collapsed', async () => {
    const res = await PATCH(req({ name: '  Waheed   Akbar ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Waheed Akbar' });
    expect(userUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Waheed Akbar' } }),
    );
  });

  it('rejects a name the form would also reject, and writes nothing', async () => {
    for (const name of ['', '   ', 'A', '12345']) {
      const res = await PATCH(req({ name }));
      expect(res.status, JSON.stringify(name)).toBe(400);
    }
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a body with no recognised field instead of reporting success', async () => {
    const res = await PATCH(req({ nmae: 'typo' }));

    expect(res.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const res = await PATCH(req({ name: 'Waheed' }));

    expect(res.status).toBe(401);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
