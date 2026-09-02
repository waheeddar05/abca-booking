/**
 * Center-wide booking notifications — who, besides the customer and the
 * staff actually assigned to a booking, gets told about it.
 *
 * The assigned-staff alerts in `notifications.ts` only reach people pinned
 * to a booking (its operator / coach / specialist / ground staff). Nobody
 * running the center sees the floor as a whole: a moderator on shift had
 * no signal that a booking had just been made unless they happened to be
 * the assigned person.
 *
 * This module holds the per-center configuration that closes that gap:
 * a role → on/off map. Every ACTIVE `CenterMembership` whose role is
 * switched on receives the same booking alert the assigned staff get,
 * for every booking at that center. MODERATOR is on by default (the
 * floor role that needs it); every other role is opt-in so enabling the
 * feature can never silently start messaging a center's whole roster.
 *
 * Stored as the `BOOKING_NOTIFICATION_CONFIG` policy, resolved
 * center → global → the defaults below (`getPolicyJson`). Edited on
 * Admin → Configuration → "Booking Notifications".
 *
 * Pure module — no Prisma, no server-only imports — so the admin editor
 * (a client component) shares these labels and defaults instead of
 * re-declaring them.
 */

import type { MembershipRole } from '@prisma/client';

export const BOOKING_NOTIFICATION_POLICY_KEY = 'BOOKING_NOTIFICATION_CONFIG';

/**
 * Display label per membership role, used both in the admin editor and in
 * the staff-facing message bodies ("Hi Anil (Personal Coach), …").
 *
 * Typed as an exhaustive `Record<MembershipRole, string>` on purpose:
 * adding a role to the Prisma enum without deciding how it reads here is
 * a compile error, not a silently-unlabelled recipient.
 */
export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  ADMIN: 'Center Admin',
  MODERATOR: 'Center Moderator',
  OPERATOR: 'Machine Operator',
  COACH: 'Personal Coach',
  SIDEARM_SPECIALIST: 'Trainer Specialist',
  GROUND_STAFF: 'Ground Staff',
};

/** Canonical role order — drives the admin editor rows and the stored JSON. */
export const NOTIFIABLE_ROLES = Object.keys(MEMBERSHIP_ROLE_LABELS) as MembershipRole[];

/** Booking lifecycle events a role can subscribe to. */
export type BookingNotificationEvent = 'created' | 'cancelled';

export interface BookingNotificationConfig {
  /** Roles whose active members receive every booking alert at the center. */
  roles: Record<MembershipRole, boolean>;
  /** Which lifecycle events are broadcast. Both on = full floor visibility. */
  events: Record<BookingNotificationEvent, boolean>;
  /**
   * Also deliver over WhatsApp (in-app is always created). Off keeps the
   * alerts free — each WhatsApp template message is billed by the BSP, and
   * a center with several admins pays per booking per recipient.
   */
  whatsapp: boolean;
}

/**
 * Defaults: moderators get every booking, nobody else does until an admin
 * turns them on. Both events broadcast, WhatsApp on — matching how the
 * assigned-staff alerts already behave.
 */
export const DEFAULT_BOOKING_NOTIFICATION_CONFIG: BookingNotificationConfig = {
  roles: {
    ADMIN: false,
    MODERATOR: true,
    OPERATOR: false,
    COACH: false,
    SIDEARM_SPECIALIST: false,
    GROUND_STAFF: false,
  },
  events: { created: true, cancelled: true },
  whatsapp: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  // Tolerate the string forms a hand-edited policy row can carry.
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * Coerce a stored policy value into a complete, safe config.
 *
 * Tolerant by design — the policy row is free-form JSON that an admin can
 * hand-edit on /admin/policies. Anything missing or malformed falls back
 * to the default for that field only, so a typo in one key can never turn
 * the whole feature off (or, worse, on for every role).
 *
 * Also accepts the shorthand `["MODERATOR", "ADMIN"]` — a bare role array —
 * which reads as "these roles on, all others off, everything else default".
 */
export function normalizeBookingNotificationConfig(raw: unknown): BookingNotificationConfig {
  const d = DEFAULT_BOOKING_NOTIFICATION_CONFIG;

  // Shorthand: a bare array of role names.
  if (Array.isArray(raw)) {
    const on = new Set(raw.filter((r): r is string => typeof r === 'string'));
    return {
      roles: Object.fromEntries(
        NOTIFIABLE_ROLES.map((role) => [role, on.has(role)]),
      ) as Record<MembershipRole, boolean>,
      events: { ...d.events },
      whatsapp: d.whatsapp,
    };
  }

  if (!raw || typeof raw !== 'object') {
    return { roles: { ...d.roles }, events: { ...d.events }, whatsapp: d.whatsapp };
  }

  const obj = raw as Record<string, unknown>;
  const rolesRaw = (obj.roles && typeof obj.roles === 'object' ? obj.roles : {}) as Record<string, unknown>;
  const eventsRaw = (obj.events && typeof obj.events === 'object' ? obj.events : {}) as Record<string, unknown>;

  return {
    roles: Object.fromEntries(
      NOTIFIABLE_ROLES.map((role) => [role, asBoolean(rolesRaw[role], d.roles[role])]),
    ) as Record<MembershipRole, boolean>,
    events: {
      created: asBoolean(eventsRaw.created, d.events.created),
      cancelled: asBoolean(eventsRaw.cancelled, d.events.cancelled),
    },
    whatsapp: asBoolean(obj.whatsapp, d.whatsapp),
  };
}

/**
 * Roles to page for a given event, in canonical order. Empty when the
 * event is switched off or no role is enabled — the caller can then skip
 * the membership lookup entirely.
 */
export function subscribedRolesFor(
  config: BookingNotificationConfig,
  event: BookingNotificationEvent,
): MembershipRole[] {
  if (!config.events[event]) return [];
  return NOTIFIABLE_ROLES.filter((role) => config.roles[role]);
}
