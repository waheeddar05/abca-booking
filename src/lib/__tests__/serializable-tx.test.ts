import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const transactionMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import { runSerializable, SERIALIZABLE_MAX_ATTEMPTS } from '../serializable-tx';

function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  transactionMock.mockReset();
});

describe('runSerializable', () => {
  it('runs the callback at SERIALIZABLE isolation and returns its result', async () => {
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));

    const result = await runSerializable(async () => 'done');

    expect(result).toBe('done');
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('re-runs the whole callback after a serialization conflict', async () => {
    let calls = 0;
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      calls += 1;
      if (calls === 1) throw serializationFailure();
      return fn({});
    });

    const result = await runSerializable(async () => 'second time lucky');

    expect(result).toBe('second time lucky');
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt cap and surfaces the conflict', async () => {
    transactionMock.mockImplementation(async () => {
      throw serializationFailure();
    });

    await expect(runSerializable(async () => 'never')).rejects.toMatchObject({ code: 'P2034' });
    expect(transactionMock).toHaveBeenCalledTimes(SERIALIZABLE_MAX_ATTEMPTS);
  });

  it('does not retry an application error', async () => {
    transactionMock.mockImplementation(async () => {
      throw new Error('address limit');
    });

    await expect(runSerializable(async () => 'never')).rejects.toThrow('address limit');
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});
