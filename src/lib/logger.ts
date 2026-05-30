/**
 * Structured logger for the booking / payment / refund flows.
 *
 * Goals:
 *   1. Every line includes the user's **email** (when available) so
 *      a Vercel runtime-logs search by email finds every event for that
 *      user in one query. Previously logs only had `userId` (a cuid),
 *      which made support investigations slow.
 *   2. Consistent `key=value` format so any field can be grepped:
 *      `email=foo@bar.com`, `paymentId=pay_xxx`, `bookingId=ck_xxx`.
 *   3. Operation tag (`op=`) groups related lines — e.g. all of
 *      `op=booking.create` for one booking attempt — so a single
 *      Vercel filter can pull the entire lifecycle.
 *   4. Errors are serialised with their message + name + status (for
 *      our typed errors) and the original cause when it's an Error.
 *
 * Use this helper everywhere we used to write `console.log('[Booking
 * user=...] msg')`. Never invent ad-hoc prefixes; that's what made the
 * existing logs hard to search.
 */

export interface LogContext {
  /** Short operation tag, e.g. `booking.create`, `booking.cancel`,
   *  `payment.verify`, `payment.refund`. Keep stable so log filters
   *  stay valid as the codebase evolves. */
  op: string;
  /** The user driving the request (the booker or the admin doing the
   *  action — NOT the booking owner, unless they're the same). */
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
  } | null;
  /** Booking owner when different from the action user (admin booking
   *  on behalf, refund processed by a different admin, …). */
  targetUser?: {
    id?: string;
    email?: string | null;
    name?: string | null;
  } | null;
  /** Center / booking / payment / razorpay identifiers — surface
   *  whatever is known at the call site. */
  centerId?: string | null;
  centerSlug?: string | null;
  bookingId?: string | null;
  bookingIds?: string[];
  paymentId?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  /** Monetary amount in rupees. The currency is always INR. */
  amount?: number | null;
  /** Any other tags worth surfacing — `slotCount=2`, `category=MACHINE`,
   *  `paymentMethod=ONLINE`, etc. Booleans, numbers, and strings are
   *  rendered as `key=value`; objects/arrays are JSON-stringified. */
  extra?: Record<string, unknown>;
}

/**
 * Build the `[key=value …]` prefix used on every log line. Returns
 * the empty string when no context is provided.
 */
function formatPrefix(ctx: LogContext): string {
  const parts: string[] = [`op=${ctx.op}`];

  if (ctx.user?.id) parts.push(`user=${ctx.user.id}`);
  if (ctx.user?.email) parts.push(`email=${ctx.user.email}`);
  else if (ctx.user?.name) parts.push(`name=${quoteIfNeeded(ctx.user.name)}`);

  if (ctx.targetUser?.id && ctx.targetUser.id !== ctx.user?.id) {
    parts.push(`forUser=${ctx.targetUser.id}`);
    if (ctx.targetUser.email) parts.push(`forEmail=${ctx.targetUser.email}`);
  }

  if (ctx.centerId) parts.push(`center=${ctx.centerSlug ?? ctx.centerId}`);
  if (ctx.paymentId) parts.push(`paymentId=${ctx.paymentId}`);
  if (ctx.razorpayOrderId) parts.push(`order=${ctx.razorpayOrderId}`);
  if (ctx.razorpayPaymentId) parts.push(`rzpPayment=${ctx.razorpayPaymentId}`);
  if (ctx.bookingId) parts.push(`booking=${ctx.bookingId}`);
  if (ctx.bookingIds && ctx.bookingIds.length > 0) {
    parts.push(`bookings=[${ctx.bookingIds.join(',')}]`);
  }
  if (typeof ctx.amount === 'number') parts.push(`amount=₹${ctx.amount}`);

  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        parts.push(`${k}=${quoteIfNeeded(String(v))}`);
      } else {
        try {
          parts.push(`${k}=${JSON.stringify(v)}`);
        } catch {
          parts.push(`${k}=[unserialisable]`);
        }
      }
    }
  }

  return `[${parts.join(' ')}]`;
}

function quoteIfNeeded(s: string): string {
  // If the value contains spaces or `=`, wrap in quotes so the
  // key=value pairs stay parseable.
  return /[\s=]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * Pull every useful field off an unknown thrown value. Reads optional
 * `status`, `code`, `name` properties without crashing on primitives.
 */
function describeError(err: unknown): {
  message: string;
  name?: string;
  status?: number;
  code?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const out: ReturnType<typeof describeError> = {
      message: err.message,
      name: err.name,
      stack: err.stack,
    };
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') out.status = status;
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') out.code = code;
    return out;
  }
  if (typeof err === 'string') return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export const log = {
  /** Informational — the happy path. */
  info(ctx: LogContext, msg: string): void {
    console.log(`${formatPrefix(ctx)} ${msg}`);
  },

  /** Warnings — recoverable issues, retries, fallbacks. */
  warn(ctx: LogContext, msg: string, err?: unknown): void {
    if (err === undefined) {
      console.warn(`${formatPrefix(ctx)} ${msg}`);
      return;
    }
    const e = describeError(err);
    console.warn(`${formatPrefix(ctx)} ${msg}`, e);
  },

  /** Errors — failures that should be investigated. The original error
   *  object is passed to console.error so Vercel preserves its stack. */
  error(ctx: LogContext, msg: string, err?: unknown): void {
    if (err === undefined) {
      console.error(`${formatPrefix(ctx)} ${msg}`);
      return;
    }
    const e = describeError(err);
    // Two-arg form keeps the stack tied to the message line in Vercel's
    // log viewer (one-arg with template-string drops it). Include the
    // serialised summary too for easier text-search.
    console.error(
      `${formatPrefix(ctx)} ${msg} :: ${e.name ?? 'Error'}${e.status ? ` (status=${e.status})` : ''}${e.code ? ` (code=${e.code})` : ''}: ${e.message}`,
      err,
    );
  },
};

/**
 * Convenience: produce a "child" log context by merging extra fields
 * into a parent. Useful when a handler is composed of sub-steps that
 * each want to add their own identifiers without re-typing the user
 * + center every time.
 */
export function withCtx(parent: LogContext, child: Partial<LogContext>): LogContext {
  return {
    ...parent,
    ...child,
    user: child.user ?? parent.user,
    targetUser: child.targetUser ?? parent.targetUser,
    extra: { ...parent.extra, ...child.extra },
  };
}
