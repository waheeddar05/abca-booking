import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Run an interactive transaction at SERIALIZABLE isolation, retrying the
 * whole callback when Postgres aborts it for a serialization conflict.
 *
 * For the read-then-write invariants that a unique index can't express —
 * "at most N rows per parent", "exactly one default per user" — two
 * concurrent requests can both pass the check under the default READ
 * COMMITTED level and both commit. Serializable makes one of them fail
 * with P2034 instead; the loser re-runs from the top and now sees the
 * winner's row. Same shape as the booking engine's transaction
 * (`/api/slots/book-resource`), kept small here for the marketplace and
 * address routes.
 *
 * Anything the callback throws that is not a serialization failure
 * propagates unchanged, so callers keep their own error classes.
 */
export const SERIALIZABLE_MAX_ATTEMPTS = 3;

type TxClient = Prisma.TransactionClient;

export async function runSerializable<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      lastError = e;
      const retriable =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (!retriable || attempt === SERIALIZABLE_MAX_ATTEMPTS) throw e;
    }
  }
  // Unreachable — the loop either returns or throws — but keeps the
  // function's return type honest for the compiler.
  throw lastError;
}
