import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────
// Stub the auth + data layers so we can drive the route handlers with
// hand-built request bodies and assert what gets persisted, without a
// real DB or session. The ball-type compatibility helpers are NOT
// mocked — we want the real coercion logic exercised end-to-end.

const packageFindUniqueMock = vi.fn();
const packageUpdateMock = vi.fn();
const packageCreateMock = vi.fn();
const machineFindUniqueMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: {
      findUnique: (args: unknown) => packageFindUniqueMock(args),
      update: (args: unknown) => packageUpdateMock(args),
      create: (args: unknown) => packageCreateMock(args),
    },
    machine: {
      findUnique: (args: unknown) => machineFindUniqueMock(args),
    },
  },
}));

vi.mock('@/lib/adminAuth', () => ({
  requireCenterAdmin: vi.fn(async () => ({ id: 'admin_1' })),
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ id: 'admin_1', isSuperAdmin: false })),
}));

vi.mock('@/lib/centers', () => ({
  resolveCurrentCenter: vi.fn(async () => ({ id: 'ctr_abca' })),
}));

import { PUT, POST } from './route';

// Minimal stand-in for NextRequest — the handlers only call `.json()`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reqWith = (body: unknown) => ({ json: async () => body }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  packageUpdateMock.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'pkg_1', ...(data as object) }));
  packageCreateMock.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'pkg_new', ...(data as object) }));
});

describe('PUT /api/admin/packages — ball type self-healing', () => {
  it('heals an incompatible tennis-machine + LEATHER ball type instead of rejecting (iWinner case)', async () => {
    // Stored row already carries a stale, incompatible pair.
    packageFindUniqueMock.mockResolvedValue({
      id: 'pkg_1', machineType: 'TENNIS', ballType: 'LEATHER',
    });

    const res = await PUT(reqWith({
      id: 'pkg_1',
      machineType: 'TENNIS',
      ballType: 'LEATHER', // what a stale <select> would send
      name: 'iWinner 10 sessions',
    }));

    expect(res.status).toBe(200);
    expect(packageUpdateMock).toHaveBeenCalledTimes(1);
    // The persisted ball type is coerced to a value valid for a tennis machine.
    const persisted = packageUpdateMock.mock.calls[0][0].data;
    expect(persisted.ballType).toBe('TENNIS');
    expect(persisted.machineType).toBe('TENNIS');
  });

  it('still rejects a genuinely unknown ball-type enum value', async () => {
    packageFindUniqueMock.mockResolvedValue({ id: 'pkg_1', machineType: 'TENNIS', ballType: 'TENNIS' });

    const res = await PUT(reqWith({ id: 'pkg_1', ballType: 'BOGUS' }));

    expect(res.status).toBe(400);
    expect(packageUpdateMock).not.toHaveBeenCalled();
  });

  it('does not re-validate the ball axis on a partial update (toggling isActive)', async () => {
    // Legacy row whose stored combo is incompatible under current rules.
    packageFindUniqueMock.mockResolvedValue({ id: 'pkg_1', machineType: 'TENNIS', ballType: 'LEATHER' });

    const res = await PUT(reqWith({ id: 'pkg_1', isActive: false }));

    expect(res.status).toBe(200);
    const persisted = packageUpdateMock.mock.calls[0][0].data;
    // Untouched: we neither rejected nor rewrote the ball type.
    expect(persisted.ballType).toBeUndefined();
    expect(persisted.isActive).toBe(false);
  });

  it('leaves a compatible pair unchanged', async () => {
    packageFindUniqueMock.mockResolvedValue({ id: 'pkg_1', machineType: 'LEATHER', ballType: 'MACHINE' });

    const res = await PUT(reqWith({ id: 'pkg_1', machineType: 'LEATHER', ballType: 'MACHINE' }));

    expect(res.status).toBe(200);
    expect(packageUpdateMock.mock.calls[0][0].data.ballType).toBe('MACHINE');
  });
});

describe('POST /api/admin/packages — ball type self-healing', () => {
  it('heals an incompatible pair on create rather than rejecting', async () => {
    const res = await POST(reqWith({
      name: 'iWinner 5 sessions',
      machineType: 'TENNIS',
      ballType: 'LEATHER',
      timingType: 'DAY',
      totalSessions: 5,
      price: 1000,
    }));

    expect(res.status).toBe(201);
    expect(packageCreateMock.mock.calls[0][0].data.ballType).toBe('TENNIS');
  });
});
