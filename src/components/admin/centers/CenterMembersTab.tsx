'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Loader2, Trash2, X, UserPlus, Mail, Phone, CalendarClock, Save } from 'lucide-react';
import { Field, TextInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type MembershipRole = 'ADMIN' | 'OPERATOR' | 'COACH' | 'SIDEARM_SPECIALIST';

type MembershipRow = {
  id: string;
  role: MembershipRole;
  isActive: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    mobileNumber: string | null;
    role: string;
  };
};

const ROLE_LABEL: Record<MembershipRole, string> = {
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  COACH: 'Coach',
  SIDEARM_SPECIALIST: 'Sidearm Specialist',
};

const ROLE_COLOR: Record<MembershipRole, string> = {
  ADMIN: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  OPERATOR: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  COACH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SIDEARM_SPECIALIST: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

export function CenterMembersTab({ centerId }: { centerId: string }) {
  const [members, setMembers] = useState<MembershipRow[]>([]);
  const [filter, setFilter] = useState<MembershipRole | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin === true;

  const refresh = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'ALL') params.set('role', filter);
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/centers/${centerId}/members?${params}`);
      if (res.ok) setMembers(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [centerId, filter]);

  const remove = async (id: string) => {
    const target = members.find((m) => m.id === id);
    const label = target ? ROLE_LABEL[target.role] : 'membership';
    if (!confirm(`Remove the ${label} role at this center? Other roles for this user are unaffected.`)) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/members/${id}`, { method: 'DELETE' });
      if (res.ok) {
        refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error || `Remove failed (HTTP ${res.status})`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  // Remove every active membership a user holds at this center in one shot.
  // The per-role X above only deactivates a single role chip, which is
  // confusing when the admin's intent is "this person no longer works here".
  const removeUserEntirely = async (userId: string) => {
    const userMemberships = members.filter((m) => m.user.id === userId);
    if (userMemberships.length === 0) return;
    const name = userMemberships[0].user.name || userMemberships[0].user.email || userMemberships[0].user.mobileNumber || 'this user';
    const roleList = userMemberships.map((m) => ROLE_LABEL[m.role]).join(', ');
    if (!confirm(`Remove ${name} from this center?\nThis revokes: ${roleList}.`)) return;
    setActionError(null);
    try {
      const results = await Promise.all(
        userMemberships.map((m) =>
          fetch(`/api/admin/centers/${centerId}/members/${m.id}`, { method: 'DELETE' }),
        ),
      );
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const data = await failed.json().catch(() => ({}));
        setActionError(data?.error || `Remove failed (HTTP ${failed.status})`);
      }
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SelectInput
            value={filter}
            onChange={(e) => setFilter(e.target.value as MembershipRole | 'ALL')}
            className="!w-auto"
          >
            <option value="ALL">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="OPERATOR">Operators</option>
            <option value="COACH">Coaches</option>
            <option value="SIDEARM_SPECIALIST">Sidearm Specialist</option>
          </SelectInput>
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }} className="flex items-center gap-2">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / email / phone"
              className="!w-56"
            />
            <SecondaryButton type="submit">Search</SecondaryButton>
          </form>
        </div>
        <PrimaryButton onClick={() => setShowNew(true)}>
          <UserPlus className="w-4 h-4" /> Assign user
        </PrimaryButton>
      </div>

      {showNew && (
        <NewMembershipForm
          centerId={centerId}
          isSuperAdmin={isSuperAdmin}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {actionError && <Banner kind="error">{actionError}</Banner>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : members.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">No members yet.</div>
      ) : (
        <div className="space-y-2">
          {groupByUser(members).map((group) => (
            <UserMembershipsRow
              key={group.userId}
              centerId={centerId}
              group={group}
              onRemoveRole={remove}
              onRemoveUser={removeUserEntirely}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Group memberships by user so the same person showing up with two
 * roles (e.g. COACH + SIDEARM_SPECIALIST) renders as one row with
 * multiple role chips, not two separate rows. Sort within a group by
 * a canonical role order so the chip order is stable.
 */
function groupByUser(members: MembershipRow[]): Array<{
  userId: string;
  user: MembershipRow['user'];
  memberships: MembershipRow[];
}> {
  const ROLE_ORDER: Record<MembershipRole, number> = {
    ADMIN: 0,
    OPERATOR: 1,
    COACH: 2,
    SIDEARM_SPECIALIST: 3,
  };
  const map = new Map<string, { userId: string; user: MembershipRow['user']; memberships: MembershipRow[] }>();
  for (const m of members) {
    let entry = map.get(m.user.id);
    if (!entry) {
      entry = { userId: m.user.id, user: m.user, memberships: [] };
      map.set(m.user.id, entry);
    }
    entry.memberships.push(m);
  }
  for (const e of map.values()) {
    e.memberships.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  }
  return Array.from(map.values());
}

function NewMembershipForm({
  centerId,
  isSuperAdmin,
  onCancel,
  onSaved,
}: {
  centerId: string;
  isSuperAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Multi-select roles. A user can be both a Coach and a Sidearm
  // Specialist (or any combination) at one center — backend creates
  // one membership row per role atomically.
  const [roles, setRoles] = useState<Set<MembershipRole>>(() => new Set(['COACH']));
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleRole = (role: MembershipRole) => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (roles.size === 0) {
      setErr('Pick at least one role');
      return;
    }
    setSaving(true);
    try {
      const trimmed = identifier.trim();
      const isEmail = trimmed.includes('@');
      const body: Record<string, unknown> = { roles: Array.from(roles) };
      if (isEmail) body.email = trimmed;
      else body.mobileNumber = trimmed;
      if (name) body.name = name.trim();

      const res = await fetch(`/api/admin/centers/${centerId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || 'Failed');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  // Center admins can grant every staff role EXCEPT ADMIN — the API
  // mirrors this restriction.
  const ROLES_AVAILABLE: Array<{ id: MembershipRole; label: string }> = [
    ...(isSuperAdmin ? [{ id: 'ADMIN' as const, label: 'Admin' }] : []),
    { id: 'OPERATOR',           label: 'Operator' },
    { id: 'COACH',              label: 'Coach' },
    { id: 'SIDEARM_SPECIALIST', label: 'Sidearm Specialist' },
  ];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
      <Field
        label="Roles"
        required
        help="Pick one or more. The same person can be a Coach and a Sidearm Specialist at the same center."
      >
        <div className="flex flex-wrap gap-1.5">
          {ROLES_AVAILABLE.map((r) => {
            const on = roles.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleRole(r.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
                  on
                    ? `${ROLE_COLOR[r.id]}`
                    : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-white/[0.16]'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field
          label="Email or mobile"
          required
          help="ADMIN/OPERATOR must already have signed in. COACH/SIDEARM_SPECIALIST will be created if not found."
        >
          <TextInput required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="user@example.com / 9876543210" />
        </Field>
        <Field label="Name (only for new coach/specialist)">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {err && <Banner kind="error">{err}</Banner>}

      <div className="flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onCancel}>
          <X className="w-4 h-4" /> Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Assign {roles.size > 1 ? `(${roles.size} roles)` : ''}
        </PrimaryButton>
      </div>
    </form>
  );
}

// ─── MemberRow + Availability editor ────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One row per user, listing every role they hold at this center as a
 * coloured chip + a per-role delete + (for COACH / SPECIALIST) a
 * schedule toggle. Lets a person be assigned to multiple roles
 * without spawning duplicate rows in the list.
 */
function UserMembershipsRow({
  centerId,
  group,
  onRemoveRole,
  onRemoveUser,
}: {
  centerId: string;
  group: { userId: string; user: MembershipRow['user']; memberships: MembershipRow[] };
  onRemoveRole: (membershipId: string) => void;
  onRemoveUser: (userId: string) => void;
}) {
  // The schedule editor is per-membership (so a user who's both a
  // Coach and a Specialist can keep different schedules per role).
  // Track which membership's editor is currently open.
  const [expandedMembershipId, setExpandedMembershipId] = useState<string | null>(null);

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="p-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">
            {group.user.name || '(no name)'}
          </div>
        </div>
        <button
          onClick={() => onRemoveUser(group.userId)}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-300/80 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/15 cursor-pointer"
          title="Remove this user from the center (revokes all their roles)"
        >
          <Trash2 className="w-3 h-3" /> Remove user
        </button>
      </div>
      <div className="px-3 pb-3 -mt-2">
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
            {group.user.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" /> {group.user.email}
              </span>
            )}
            {group.user.mobileNumber && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" /> {group.user.mobileNumber}
              </span>
            )}
          </div>
          {/* Role chips — one per active membership at this center.
              Each chip carries its own schedule + delete affordances
              so the admin can manage roles independently. */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {group.memberships.map((m) => {
              const supportsSchedule = m.role === 'COACH' || m.role === 'SIDEARM_SPECIALIST';
              const expanded = expandedMembershipId === m.id;
              return (
                <span
                  key={m.id}
                  className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border text-[10px] uppercase tracking-wide ${ROLE_COLOR[m.role]}`}
                >
                  {ROLE_LABEL[m.role]}
                  {supportsSchedule && (
                    <button
                      onClick={() => setExpandedMembershipId(expanded ? null : m.id)}
                      className={`ml-0.5 p-0.5 rounded-full cursor-pointer ${
                        expanded ? 'bg-white/15' : 'hover:bg-white/10'
                      }`}
                      title="Weekly schedule"
                    >
                      <CalendarClock className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => onRemoveRole(m.id)}
                    className="p-0.5 rounded-full hover:bg-red-500/20 cursor-pointer"
                    title={`Remove ${ROLE_LABEL[m.role]} role`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {expandedMembershipId && (
        <div className="border-t border-white/[0.06] p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            {ROLE_LABEL[group.memberships.find((m) => m.id === expandedMembershipId)!.role]} schedule
          </div>
          <AvailabilityEditor centerId={centerId} membershipId={expandedMembershipId} />
        </div>
      )}
    </div>
  );
}

interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

function AvailabilityEditor({
  centerId,
  membershipId,
}: {
  centerId: string;
  membershipId: string;
}) {
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/centers/${centerId}/members/${membershipId}/availability`)
      .then((r) => (r.ok ? r.json() : { windows: [] }))
      .then((data) => { if (!cancelled) setWindows(data.windows ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [centerId, membershipId]);

  const updateWindow = (i: number, patch: Partial<AvailabilityWindow>) => {
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  };

  const addWindow = () => {
    setWindows((prev) => [...prev, { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
  };

  const removeWindow = (i: number) => {
    setWindows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const validationIssues = (): string[] => {
    const issues: string[] = [];
    windows.forEach((w, i) => {
      if (!TIME_RE.test(w.startTime)) issues.push(`Row ${i + 1}: invalid start time`);
      if (!TIME_RE.test(w.endTime)) issues.push(`Row ${i + 1}: invalid end time`);
      if (TIME_RE.test(w.startTime) && TIME_RE.test(w.endTime) && w.endTime <= w.startTime) {
        issues.push(`Row ${i + 1}: end must be after start`);
      }
    });
    return issues;
  };

  const save = async () => {
    const issues = validationIssues();
    if (issues.length > 0) {
      setMessage({ text: issues[0], ok: false });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/members/${membershipId}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data?.error || 'Save failed', ok: false });
        return;
      }
      setWindows(data.windows ?? []);
      setMessage({ text: 'Saved', ok: true });
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-3 justify-center text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading schedule…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500 leading-relaxed">
        Weekly schedule. Slots outside any window hide this member from
        the user-side picker. Empty schedule = always available.
      </div>

      {windows.length === 0 ? (
        <div className="text-[11px] text-slate-600 italic py-1">
          No restrictions configured (always available).
        </div>
      ) : (
        <div className="space-y-1.5">
          {windows.map((w, i) => (
            <div key={i} className="grid grid-cols-[auto_auto_auto_auto] gap-2 items-center">
              <select
                value={w.dayOfWeek}
                onChange={(e) => updateWindow(i, { dayOfWeek: Number(e.target.value) })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                {DAY_LABELS.map((d, idx) => (
                  <option key={idx} value={idx}>{d}</option>
                ))}
              </select>
              <input
                type="time"
                value={w.startTime}
                onChange={(e) => updateWindow(i, { startTime: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
              />
              <input
                type="time"
                value={w.endTime}
                onChange={(e) => updateWindow(i, { endTime: e.target.value })}
                className="bg-white/[0.04] border border-white/[0.1] text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:border-accent [color-scheme:dark]"
              />
              <button
                type="button"
                onClick={() => removeWindow(i)}
                className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                title="Remove window"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1.5">
        <button
          type="button"
          onClick={addWindow}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
        >
          <Plus className="w-3 h-3" /> Add window
        </button>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs font-medium ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
