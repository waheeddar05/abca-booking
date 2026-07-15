'use client';

import { useSession } from 'next-auth/react';

/**
 * Client-side view of the current admin user's role, used to hide UI that
 * a MODERATOR is not allowed to use.
 *
 * MODERATOR is a restricted admin (see the note in schema.prisma). The
 * session's `user.role` is the global platform role — a moderator-only
 * user resolves to `MODERATOR`, a full admin to `ADMIN`. These flags gate
 * the UI only; every restricted action is also enforced server-side, so
 * hiding a control is a convenience, not the security boundary.
 */
export function useAdminRole() {
  const { data: session } = useSession();
  const user = session?.user as
    | { role?: string; isSuperAdmin?: boolean }
    | undefined;
  const isSuperAdmin = user?.isSuperAdmin === true;
  const isModerator = user?.role === 'MODERATOR' && !isSuperAdmin;
  return {
    role: user?.role,
    isSuperAdmin,
    isModerator,
    /** Full admin or super admin — everything a moderator can't do. */
    isFullAdmin: user?.role === 'ADMIN' || isSuperAdmin,
  };
}
