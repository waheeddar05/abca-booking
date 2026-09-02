'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { MembershipRole } from '@prisma/client';
import {
  BOOKING_NOTIFICATION_POLICY_KEY,
  MEMBERSHIP_ROLE_LABELS,
  NOTIFIABLE_ROLES,
  normalizeBookingNotificationConfig,
  type BookingNotificationConfig,
} from '@/lib/booking-notifications';

/**
 * Per-center control over who — beyond the customer and the staff actually
 * assigned to a booking — is told about every booking at the center.
 *
 * Persists `BOOKING_NOTIFICATION_CONFIG` through the scope-aware admin
 * policies API, driven by the page's single Save button
 * (`externalSaveTrigger`) exactly like the Booking Categories editor.
 */

const ROLE_HINTS: Record<MembershipRole, string> = {
  ADMIN: 'Full center admins',
  MODERATOR: 'Restricted admins running the floor',
  OPERATOR: 'Every operator at the center',
  COACH: 'Every personal coach at the center',
  SIDEARM_SPECIALIST: 'Every trainer specialist at the center',
  GROUND_STAFF: 'Every ground staff member at the center',
};

export function BookingNotificationsEditor({
  scope,
  centerLabel,
  externalSaveTrigger,
  onSaveStatus,
}: {
  scope: 'center' | 'global';
  centerLabel: string;
  externalSaveTrigger?: number;
  onSaveStatus?: (status: { saving: boolean; message: { text: string; ok: boolean } | null }) => void;
}) {
  const [config, setConfig] = useState<BookingNotificationConfig>(
    () => normalizeBookingNotificationConfig(null),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  // Whether the stored config was actually read back. Without this, a
  // failed GET would leave `config` at the shipped defaults while the card
  // rendered as if it had loaded — and since the page's single Save button
  // fires every trigger-based editor, saving an unrelated field would
  // silently overwrite the center's real subscriptions with those
  // defaults. Nothing is editable or saveable until the load succeeds.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/policies?scope=${scope}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setLoadError(body?.error || `Couldn't load settings (HTTP ${res.status})`);
          return;
        }
        const rows: Array<{ key: string; value: string }> = await res.json();
        if (cancelled) return;
        const row = rows.find((r) => r.key === BOOKING_NOTIFICATION_POLICY_KEY);
        let parsed: unknown = null;
        if (row) {
          try {
            parsed = JSON.parse(row.value);
          } catch {
            // Malformed row — normalize() falls back to the defaults.
          }
        }
        // Always run the stored value through the shared normalizer so the
        // form shows exactly what the server will resolve at send time.
        setConfig(normalizeBookingNotificationConfig(parsed));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Couldn't load settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const toggleRole = (role: MembershipRole) => {
    setConfig((prev) => ({ ...prev, roles: { ...prev.roles, [role]: !prev.roles[role] } }));
  };

  const toggleEvent = (event: 'created' | 'cancelled') => {
    setConfig((prev) => ({ ...prev, events: { ...prev.events, [event]: !prev.events[event] } }));
  };

  useEffect(() => {
    if (externalSaveTrigger && externalSaveTrigger > 0) {
      save();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSaveTrigger]);

  useEffect(() => {
    onSaveStatus?.({ saving, message });
  }, [saving, message, onSaveStatus]);

  const save = async () => {
    // Never write a config we never read — that would clobber the center's
    // real subscriptions with the shipped defaults.
    if (loadError) {
      setMessage({ text: 'Booking notifications not saved — settings never loaded', ok: false });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/policies?scope=${scope}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: BOOKING_NOTIFICATION_POLICY_KEY,
          value: JSON.stringify(config),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({ text: body?.error || 'Save failed', ok: false });
        return;
      }
      setMessage({ text: `Saved for ${centerLabel}`, ok: true });
      setTimeout(() => setMessage(null), 3500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-6 justify-center text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (loadError) {
    // Show the failure instead of an editable form seeded with defaults —
    // editing on top of the wrong baseline is how a center loses its
    // configuration.
    return (
      <div className="px-3 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/30 space-y-1">
        <p className="text-xs font-semibold text-red-300">{loadError}</p>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Current settings are unchanged and won&apos;t be overwritten by Save.
          Reload the page to try again.
        </p>
      </div>
    );
  }

  const activeRoles = NOTIFIABLE_ROLES.filter((r) => config.roles[r]);
  const noEvents = !config.events.created && !config.events.cancelled;

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500 leading-relaxed">
        Everyone holding a switched-on role at {centerLabel} gets an alert for
        every booking — on top of the customer&apos;s confirmation and the
        staff actually assigned to it. Assigned staff are never notified
        twice, and a booking&apos;s own booker never receives the staff copy.
      </div>

      {/* Roles — one row per membership role, mirroring the Booking
          Categories control so every selectable list on Configuration
          reads the same way. */}
      <div className="space-y-1.5">
        {NOTIFIABLE_ROLES.map((role) => {
          const on = config.roles[role];
          return (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`group relative w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                on
                  ? 'bg-accent/10 text-accent border-accent/20 shadow-sm shadow-accent/5'
                  : 'bg-black/20 text-slate-500 border-white/[0.05] hover:border-white/[0.1] hover:text-slate-400'
              }`}
            >
              <div className="min-w-0">
                <span className={`text-xs font-semibold ${on ? 'text-white' : 'text-slate-400'}`}>
                  {MEMBERSHIP_ROLE_LABELS[role]}
                </span>
                <span className="ml-2 text-[9px] text-slate-500 uppercase tracking-tight">
                  {ROLE_HINTS[role]}
                </span>
              </div>
              <div
                className={`w-4 h-4 flex-shrink-0 rounded-full border flex items-center justify-center transition-all ${
                  on ? 'bg-accent border-accent text-primary' : 'border-white/10 bg-white/5'
                }`}
              >
                {on && (
                  <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Events + channel */}
      <div className="space-y-1.5 pt-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          When to notify
        </p>
        {(
          [
            { key: 'created' as const, label: 'New bookings', sub: 'Someone books a slot' },
            { key: 'cancelled' as const, label: 'Cancellations', sub: 'A booking is cancelled' },
          ]
        ).map((e) => {
          const on = config.events[e.key];
          return (
            <button
              key={e.key}
              type="button"
              onClick={() => toggleEvent(e.key)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
                on
                  ? 'bg-accent/10 border-accent/20'
                  : 'bg-black/20 border-white/[0.05] hover:border-white/[0.1]'
              }`}
            >
              <div className="min-w-0">
                <span className={`text-xs font-semibold ${on ? 'text-white' : 'text-slate-400'}`}>
                  {e.label}
                </span>
                <span className="ml-2 text-[9px] text-slate-500 uppercase tracking-tight">{e.sub}</span>
              </div>
              <div
                className={`w-4 h-4 flex-shrink-0 rounded-full border flex items-center justify-center transition-all ${
                  on ? 'bg-accent border-accent text-primary' : 'border-white/10 bg-white/5'
                }`}
              >
                {on && (
                  <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setConfig((prev) => ({ ...prev, whatsapp: !prev.whatsapp }))}
          className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left border transition-all cursor-pointer ${
            config.whatsapp
              ? 'bg-accent/10 border-accent/20'
              : 'bg-black/20 border-white/[0.05] hover:border-white/[0.1]'
          }`}
        >
          <div className="min-w-0">
            <span className={`text-xs font-semibold ${config.whatsapp ? 'text-white' : 'text-slate-400'}`}>
              Also send on WhatsApp
            </span>
            <span className="ml-2 text-[9px] text-slate-500 uppercase tracking-tight">
              In-app alerts are always sent
            </span>
          </div>
          <div
            className={`w-4 h-4 flex-shrink-0 rounded-full border flex items-center justify-center transition-all ${
              config.whatsapp ? 'bg-accent border-accent text-primary' : 'border-white/10 bg-white/5'
            }`}
          >
            {config.whatsapp && (
              <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </button>
      </div>

      {/* Live summary — what this configuration actually does. */}
      <p className="text-[11px] text-slate-500 italic">
        {activeRoles.length === 0
          ? 'No roles selected — only the customer and the staff assigned to a booking are notified.'
          : noEvents
            ? 'No events selected — nothing will be broadcast until "New bookings" or "Cancellations" is turned on.'
            : `${activeRoles.map((r) => MEMBERSHIP_ROLE_LABELS[r]).join(', ')} will be notified about ${
                config.events.created && config.events.cancelled
                  ? 'new bookings and cancellations'
                  : config.events.created
                    ? 'new bookings'
                    : 'cancellations'
              }${config.whatsapp ? ' (in-app + WhatsApp).' : ' (in-app only).'}`}
      </p>

      {externalSaveTrigger === undefined && (
        <div className="flex items-center justify-end gap-2 pt-1">
          {message && (
            <span className={`text-xs font-medium ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}
