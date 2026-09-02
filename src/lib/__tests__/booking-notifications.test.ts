import { describe, it, expect } from 'vitest';
import { MembershipRole } from '@prisma/client';
import {
  DEFAULT_BOOKING_NOTIFICATION_CONFIG,
  MEMBERSHIP_ROLE_LABELS,
  NOTIFIABLE_ROLES,
  normalizeBookingNotificationConfig,
  subscribedRolesFor,
} from '../booking-notifications';

describe('MEMBERSHIP_ROLE_LABELS', () => {
  // Parity guard: every MembershipRole in the Prisma schema must be
  // configurable and labelled here. Adding a role to the enum without a
  // label would leave it silently un-notifiable, so this fails loudly
  // instead. (Same pattern as the ledger ↔ booking-category parity test.)
  it('covers every MembershipRole, one for one', () => {
    expect([...NOTIFIABLE_ROLES].sort()).toEqual(Object.values(MembershipRole).sort());
    for (const role of Object.values(MembershipRole)) {
      expect(MEMBERSHIP_ROLE_LABELS[role]).toBeTruthy();
    }
  });
});

describe('normalizeBookingNotificationConfig', () => {
  it('defaults to moderators only, both events, WhatsApp on', () => {
    const config = normalizeBookingNotificationConfig(null);
    expect(config.roles.MODERATOR).toBe(true);
    expect(config.roles.ADMIN).toBe(false);
    expect(config.roles.OPERATOR).toBe(false);
    expect(config.roles.COACH).toBe(false);
    expect(config.roles.SIDEARM_SPECIALIST).toBe(false);
    expect(config.roles.GROUND_STAFF).toBe(false);
    expect(config.events).toEqual({ created: true, cancelled: true });
    expect(config.whatsapp).toBe(true);
    expect(config).toEqual(DEFAULT_BOOKING_NOTIFICATION_CONFIG);
  });

  it('returns a fresh object — mutating the result cannot corrupt the defaults', () => {
    const config = normalizeBookingNotificationConfig(null);
    config.roles.ADMIN = true;
    config.events.created = false;
    expect(DEFAULT_BOOKING_NOTIFICATION_CONFIG.roles.ADMIN).toBe(false);
    expect(DEFAULT_BOOKING_NOTIFICATION_CONFIG.events.created).toBe(true);
  });

  it('applies stored role flags and keeps unspecified roles at their default', () => {
    const config = normalizeBookingNotificationConfig({
      roles: { ADMIN: true, MODERATOR: false },
    });
    expect(config.roles.ADMIN).toBe(true);
    expect(config.roles.MODERATOR).toBe(false);
    // Not mentioned → default (off).
    expect(config.roles.OPERATOR).toBe(false);
  });

  it('tolerates the string booleans a hand-edited policy row can carry', () => {
    const config = normalizeBookingNotificationConfig({
      roles: { ADMIN: 'true', MODERATOR: 'false' },
      events: { created: 'false' },
      whatsapp: 'false',
    });
    expect(config.roles.ADMIN).toBe(true);
    expect(config.roles.MODERATOR).toBe(false);
    expect(config.events.created).toBe(false);
    expect(config.events.cancelled).toBe(true); // untouched → default
    expect(config.whatsapp).toBe(false);
  });

  it('ignores unknown roles and non-boolean junk without losing the rest', () => {
    const config = normalizeBookingNotificationConfig({
      roles: { ADMIN: true, SUPER_HERO: true, MODERATOR: 42 },
      events: 'nope',
      whatsapp: { weird: true },
    });
    expect(config.roles.ADMIN).toBe(true);
    expect(config.roles.MODERATOR).toBe(true); // 42 is junk → default (true)
    expect(Object.keys(config.roles).sort()).toEqual([...NOTIFIABLE_ROLES].sort());
    expect(config.events).toEqual({ created: true, cancelled: true });
    expect(config.whatsapp).toBe(true);
  });

  it('falls back to defaults for a malformed value', () => {
    for (const raw of [undefined, null, '', 'garbage', 7, true]) {
      expect(normalizeBookingNotificationConfig(raw)).toEqual(DEFAULT_BOOKING_NOTIFICATION_CONFIG);
    }
  });

  it('accepts the bare role-array shorthand as "these on, all others off"', () => {
    const config = normalizeBookingNotificationConfig(['MODERATOR', 'ADMIN']);
    expect(config.roles.MODERATOR).toBe(true);
    expect(config.roles.ADMIN).toBe(true);
    expect(config.roles.OPERATOR).toBe(false);
    expect(config.events).toEqual({ created: true, cancelled: true });
  });

  it('reads an empty role array as "nobody" — not as "unset, use defaults"', () => {
    const config = normalizeBookingNotificationConfig([]);
    expect(Object.values(config.roles).every((v) => v === false)).toBe(true);
  });

  it('round-trips its own output unchanged', () => {
    const first = normalizeBookingNotificationConfig({
      roles: { ADMIN: true, MODERATOR: true, OPERATOR: true },
      events: { created: true, cancelled: false },
      whatsapp: false,
    });
    expect(normalizeBookingNotificationConfig(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });
});

describe('subscribedRolesFor', () => {
  it('returns the enabled roles in canonical order', () => {
    const config = normalizeBookingNotificationConfig({
      roles: { GROUND_STAFF: true, ADMIN: true, MODERATOR: true },
    });
    // Canonical order = NOTIFIABLE_ROLES order, not the stored key order.
    expect(subscribedRolesFor(config, 'created')).toEqual(['ADMIN', 'MODERATOR', 'GROUND_STAFF']);
  });

  it('returns nothing when the event is switched off', () => {
    const config = normalizeBookingNotificationConfig({
      roles: { MODERATOR: true },
      events: { created: true, cancelled: false },
    });
    expect(subscribedRolesFor(config, 'created')).toEqual(['MODERATOR']);
    expect(subscribedRolesFor(config, 'cancelled')).toEqual([]);
  });

  it('returns nothing when no role is enabled', () => {
    const config = normalizeBookingNotificationConfig([]);
    expect(subscribedRolesFor(config, 'created')).toEqual([]);
    expect(subscribedRolesFor(config, 'cancelled')).toEqual([]);
  });
});
