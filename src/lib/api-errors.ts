/**
 * API error → user-safe message mapping.
 *
 * Several routes used to bubble `error.message` straight back to the
 * client. That's fine for application errors (`BookingResourceError`,
 * Zod validation, etc.) but leaks internal details when the error is a
 * Prisma stacktrace / Neon cold-start timeout, which the user shouldn't
 * be staring at on the slot grid.
 *
 * `sanitizeApiError` keeps known-safe messages, replaces DB / network /
 * generic exceptions with a friendly fallback, and always logs the
 * original error server-side for debugging.
 */
import { Prisma } from '@prisma/client';
import { BookingResourceError } from '@/lib/resource-booking';

/** Known application-level error classes whose `message` is safe to surface. */
function isUserSafeError(err: unknown): err is Error {
  if (err instanceof BookingResourceError) return true;
  return false;
}

/** Recognise database / connection failures that shouldn't be shown verbatim. */
function isDatabaseError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Connection-level codes (P1xxx). P2xxx are query-level — those are
    // application errors and should not be rewritten globally.
    if (err.code.startsWith('P1')) return true;
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("Can't reach database server")) return true;
    if (msg.includes('Connection terminated')) return true;
    if (msg.toLowerCase().includes('econnrefused')) return true;
    if (msg.toLowerCase().includes('etimedout')) return true;
  }
  return false;
}

export interface SanitizedError {
  /** Message safe to display to the user. */
  message: string;
  /** HTTP status to return. Defaults to 500. */
  status: number;
}

/**
 * Convert any thrown value into a user-safe `{ message, status }`. Logs
 * the original error to the server console with the supplied `tag`.
 *
 * @param error    The thrown value.
 * @param tag      Short label for server logs (e.g. 'slots.resource-availability').
 * @param fallback Generic message for unknown errors.
 */
export function sanitizeApiError(
  error: unknown,
  tag: string,
  fallback = 'Something went wrong. Please try again.',
): SanitizedError {
  // Always log the raw error so we can debug from the server side.
  console.error(`[api:${tag}]`, error);

  if (isUserSafeError(error)) {
    const status = (error as BookingResourceError).status ?? 400;
    return { message: error.message, status };
  }

  if (isDatabaseError(error)) {
    return {
      message: 'We had trouble reaching the database. Please try again in a moment.',
      status: 503,
    };
  }

  // Anything else — keep it generic for the user, details are in the log.
  return { message: fallback, status: 500 };
}
