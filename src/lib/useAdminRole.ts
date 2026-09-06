'use client';

import { useCurrentUser } from '@/lib/current-user';

/**
 * Client-side view of the current admin user's role, used to hide UI that
 * a MODERATOR is not allowed to use.
 *
 * MODERATOR is a restricted admin (see the note in schema.prisma). The
 * user's `role` is the global platform role — a moderator-only user
 * resolves to `MODERATOR`, a full admin to `ADMIN`. These flags gate the
 * UI only; every restricted action is also enforced server-side, so hiding
 * a control is a convenience, not the security boundary.
 *
 * Reads `useCurrentUser()` rather than `useSession()`: WhatsApp logins have
 * no NextAuth session, so a session-based check reports "no role" for every
 * admin and moderator and collapses the panel to nothing.
 */
export function useAdminRole() {
  const { user, loading } = useCurrentUser();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const isModerator = user?.role === 'MODERATOR' && !isSuperAdmin;
  const isStoreAdmin = user?.isStoreAdmin === true;
  return {
    role: user?.role,
    isSuperAdmin,
    isModerator,
    /** Holds the platform-level store grant (super admins implicitly do). */
    isStoreAdmin,
    /** May run the Cricket Store: store admin or super admin. Never a center admin as such. */
    canManageStore: isStoreAdmin || isSuperAdmin,
    /** Full admin or super admin — everything a moderator can't do. */
    isFullAdmin: user?.role === 'ADMIN' || isSuperAdmin,
    /** True until the profile has loaded — don't decide gating on a blank. */
    loading,
  };
}
