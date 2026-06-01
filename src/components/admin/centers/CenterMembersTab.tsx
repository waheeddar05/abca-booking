'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Loader2, Trash2, X, UserPlus, Mail, Phone, CalendarClock, Save, Pencil } from 'lucide-react';
import { Field, TextInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type MembershipRole = 'ADMIN' | 'OPERATOR' | 'COACH' | 'SIDEARM_SPECIALIST' | 'GROUND_STAFF';

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
  GROUND_STAFF: 'Ground Staff',
};

const ROLE_COLOR: Record<MembershipRole, string> = {
  ADMIN: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  OPERATOR: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  COACH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SIDEARM_SPECIALIST: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  GROUND_STAFF: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
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

  // Persist a member's role set in one shot from the per-row checkboxes.
  // Diffs the desired roles against what the user currently holds: grants
  // newly-checked roles via a single POST and revokes unchecked ones by
  // deleting their membership rows. Returns null on success or an error
  // string so the row can surface it inline next to its Save button.
  const saveRoles = async (
    group: { userId: string; memberships: MembershipRow[] },
    desired: Set<MembershipRole>,
  ): Promise<string | null> => {
    const current = new Set(group.memberships.map((m) => m.role));
    const toAdd = Array.from(desired).filter((r) => !current.has(r));
    const toRemove = group.memberships.filter((m) => !desired.has(m.role));
    if (toAdd.length === 0 && toRemove.length === 0) return null;
    try {
      if (toAdd.length > 0) {
        const res = await fetch(`/api/admin/centers/${centerId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: group.userId, roles: toAdd }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data?.error || `Save failed (HTTP ${res.status})`;
        }
      }
      for (const m of toRemove) {
        const res = await fetch(`/api/admin/centers/${centerId}/members/${m.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data?.error || `Save failed (HTTP ${res.status})`;
        }
      }
      await refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Save failed';
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
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <SelectInput
            value={filter}
            onChange={(e) => setFilter(e.target.value as MembershipRole | 'ALL')}
            className="!w-auto !text-xs"
          >
            <option value="ALL">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="OPERATOR">Operators</option>
            <option value="COACH">Coaches</option>
            <option value="SIDEARM_SPECIALIST">Sidearm Specialist</option>
            <option value="GROUND_STAFF">Ground Staff</option>
          </SelectInput>
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }} className="flex items-center gap-2 flex-1 min-w-[200px]">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name / email / mobile"
              className="flex-1 !text-xs"
            />
            <SecondaryButton type="submit" className="!text-xs shrink-0">Search</SecondaryButton>
          </form>
        </div>
        <PrimaryButton onClick={() => setShowNew(true)} className="shrink-0">
          <UserPlus className="w-4 h-4" /> Assign
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {groupByUser(members).map((group) => (
            <UserMembershipsRow
              key={group.userId}
              centerId={centerId}
              group={group}
              isSuperAdmin={isSuperAdmin}
              onSaveRoles={saveRoles}
              onRemoveUser={removeUserEntirely}
              onUserUpdated={refresh}
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
    GROUND_STAFF: 4,
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

// A row returned by /api/admin/users/search — the typeahead source for
// "Assign user". Includes a flattened membership summary so the admin
// can see which centers a user already belongs to before assigning.
type UserSearchHit = {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  role: string;
  centerMemberships: Array<{
    centerId: string;
    role: string;
    center: { id: string; name: string; shortName: string | null };
  }>;
};

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

  // Picker state. The admin either:
  //   - searches and picks an existing user (selected != null), or
  //   - types an email/mobile in the manual fallback to mint a new one.
  // `query` drives the typeahead; `selected` is what we send when set.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchHit[]>([]);
  const [selected, setSelected] = useState<UserSearchHit | null>(null);
  const [searching, setSearching] = useState(false);

  // Manual fallback for users who don't exist yet (only relevant for
  // COACH / SIDEARM_SPECIALIST — backend rejects "mint" for OPERATOR /
  // ADMIN). Toggled when the admin clicks "Add new user instead".
  const [manualMode, setManualMode] = useState(false);
  const [manualIdentifier, setManualIdentifier] = useState('');
  const [manualName, setManualName] = useState('');

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

  // Debounced typeahead: query the user-search endpoint when the input
  // has at least 2 characters. 300 ms debounce keeps it cheap.
  useEffect(() => {
    if (manualMode) return;
    if (selected) return; // freeze results while a user is locked in
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((data) => { if (!cancelled) setResults(data.users ?? []); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, manualMode, selected]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (roles.size === 0) {
      setErr('Pick at least one role');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { roles: Array.from(roles) };
      if (selected) {
        body.userId = selected.id;
      } else if (manualMode) {
        const trimmed = manualIdentifier.trim();
        if (!trimmed) {
          setErr('Enter an email or mobile.');
          setSaving(false);
          return;
        }
        if (trimmed.includes('@')) body.email = trimmed;
        else body.mobileNumber = trimmed;
        if (manualName) body.name = manualName.trim();
      } else {
        setErr('Search and pick a user, or click "Add new user instead".');
        setSaving(false);
        return;
      }

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
    { id: 'GROUND_STAFF',       label: 'Ground Staff' },
  ];

  // Already-at-this-center memberships matter for the typeahead so the
  // admin can see they're re-assigning vs adding net-new. Computed on
  // each render — small list, no perf concern.
  const alreadyHereRoles = (u: UserSearchHit): MembershipRole[] =>
    u.centerMemberships
      .filter((m) => m.centerId === centerId)
      .map((m) => m.role as MembershipRole);

  return (
    <form onSubmit={submit} className="space-y-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3.5">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-white">Assign a member</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-md text-slate-400 hover:bg-white/[0.08] hover:text-white cursor-pointer"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

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

      {!manualMode ? (
        <Field
          label="Find user"
          required
          help="Search by name, email, or phone. Picks from existing users across the platform."
        >
          {selected ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-accent/10 border border-accent/30">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {selected.name || '(no name)'}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {selected.email || selected.mobileNumber || selected.id}
                </div>
                {alreadyHereRoles(selected).length > 0 && (
                  <div className="text-[10px] text-amber-300 mt-0.5">
                    Already at this center as: {alreadyHereRoles(selected).map((r) => ROLE_LABEL[r]).join(', ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setSelected(null); setQuery(''); setResults([]); }}
                className="shrink-0 p-1 rounded-md text-slate-300 hover:bg-white/[0.08] cursor-pointer"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type at least 2 characters…"
                autoFocus
              />
              {(query.trim().length >= 2 || searching) && (
                <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f1d2f] divide-y divide-white/[0.04]">
                  {searching && (
                    <div className="px-3 py-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                    </div>
                  )}
                  {!searching && results.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-slate-500">
                      No users match &ldquo;{query}&rdquo;.
                    </div>
                  )}
                  {results.map((u) => {
                    const here = alreadyHereRoles(u);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { setSelected(u); setQuery(''); setResults([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-white/[0.04] cursor-pointer"
                      >
                        <div className="text-sm text-white truncate">
                          {u.name || '(no name)'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {[u.email, u.mobileNumber].filter(Boolean).join(' · ') || u.id}
                        </div>
                        {here.length > 0 && (
                          <div className="text-[10px] text-amber-300/80 mt-0.5">
                            Here as: {here.map((r) => ROLE_LABEL[r]).join(', ')}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Field>
      ) : (
        // Manual fallback for users who haven't signed in yet. Backend
        // still rejects this path for OPERATOR / ADMIN (those need an
        // existing User row), but COACH / SIDEARM_SPECIALIST get
        // minted on the fly.
        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Email or mobile"
            required
            help="ADMIN/OPERATOR must already have signed in. COACH/SIDEARM_SPECIALIST will be created if not found."
          >
            <TextInput
              required
              value={manualIdentifier}
              onChange={(e) => setManualIdentifier(e.target.value)}
              placeholder="user@example.com / 9876543210"
            />
          </Field>
          <Field label="Name (only for new coach/specialist)">
            <TextInput
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>
      )}

      {err && <Banner kind="error">{err}</Banner>}

      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={() => {
            setManualMode((v) => !v);
            setErr(null);
            setSelected(null);
            setQuery('');
            setResults([]);
          }}
          className="text-[11px] text-accent hover:underline cursor-pointer"
        >
          {manualMode ? '← Back to user search' : '+ Add new user instead'}
        </button>
        <div className="flex gap-2">
          <SecondaryButton type="button" onClick={onCancel}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Assign {roles.size > 1 ? `(${roles.size} roles)` : ''}
          </PrimaryButton>
        </div>
      </div>
    </form>
  );
}

// ─── MemberRow + Availability editor ────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// All assignable roles, in a stable display order, with their labels.
const ALL_ROLES: MembershipRole[] = ['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST', 'GROUND_STAFF'];

/**
 * One card per user. Row 1 shows the member's name + contact + edit/remove
 * actions; Row 2 lays out every role as a checkbox in a clean horizontal
 * row; Row 3 is a Save button that commits the checked role set in one shot
 * (granting newly-checked roles and revoking unchecked ones). COACH /
 * SIDEARM_SPECIALIST roles the user currently holds expose a schedule
 * toggle next to their checkbox.
 */
function UserMembershipsRow({
  centerId,
  group,
  isSuperAdmin,
  onSaveRoles,
  onRemoveUser,
  onUserUpdated,
}: {
  centerId: string;
  group: { userId: string; user: MembershipRow['user']; memberships: MembershipRow[] };
  isSuperAdmin: boolean;
  onSaveRoles: (
    group: { userId: string; memberships: MembershipRow[] },
    desired: Set<MembershipRole>,
  ) => Promise<string | null>;
  onRemoveUser: (userId: string) => void;
  onUserUpdated: () => void;
}) {
  const currentRoles = new Set<MembershipRole>(group.memberships.map((m) => m.role));
  const membershipIdByRole = new Map<MembershipRole, string>(
    group.memberships.map((m) => [m.role, m.id]),
  );
  // Stable signature of the held roles — used to re-seed the checkboxes and
  // collapse any open schedule panel whenever the parent refreshes this row.
  const rolesSignature = group.memberships.map((m) => m.role).sort().join(',');

  const [checked, setChecked] = useState<Set<MembershipRole>>(() => new Set(currentRoles));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [expandedMembershipId, setExpandedMembershipId] = useState<string | null>(null);

  useEffect(() => {
    setChecked(new Set(group.memberships.map((m) => m.role)));
    setExpandedMembershipId(null);
    setSaveMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesSignature]);

  const toggle = (role: MembershipRole) => {
    // Center admins (non-super) can neither grant nor revoke ADMIN.
    if (role === 'ADMIN' && !isSuperAdmin) return;
    setSaveMsg(null);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const dirty =
    checked.size !== currentRoles.size ||
    Array.from(checked).some((r) => !currentRoles.has(r));

  const handleSave = async () => {
    if (checked.size === 0 &&
        !confirm('No roles selected — this removes the member from the center. Continue?')) {
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    const err = await onSaveRoles(group, checked);
    setSaving(false);
    if (err) {
      setSaveMsg({ text: err, ok: false });
      return;
    }
    setSaveMsg({ text: 'Saved', ok: true });
    setTimeout(() => setSaveMsg(null), 2500);
  };

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="p-3 space-y-2.5">
        {/* Row 1 — member name + contact + actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-white truncate">
              {group.user.name || group.user.email || group.user.mobileNumber || '(no name)'}
            </span>
            <div className="flex gap-1 shrink-0">
              {group.user.email && (
                <span title={group.user.email}><Mail className="w-3.5 h-3.5 text-slate-500" /></span>
              )}
              {group.user.mobileNumber && (
                <span title={group.user.mobileNumber}><Phone className="w-3.5 h-3.5 text-slate-500" /></span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEditing(!editing)}
              title="Edit profile"
              className={`p-1.5 rounded-lg border text-slate-400 hover:text-white cursor-pointer ${editing ? 'bg-accent/10 border-accent/30 text-accent' : 'border-transparent'}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onRemoveUser(group.userId)}
              title="Remove from center"
              className="p-1.5 rounded-lg border border-transparent text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2 — role checkboxes */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {ALL_ROLES.map((role) => {
            const disabled = role === 'ADMIN' && !isSuperAdmin;
            const supportsSchedule = role === 'COACH' || role === 'SIDEARM_SPECIALIST';
            const scheduleId = membershipIdByRole.get(role);
            const scheduleOpen = !!scheduleId && expandedMembershipId === scheduleId;
            return (
              <div key={role} className="inline-flex items-center gap-1.5">
                <label
                  className={`inline-flex items-center gap-1.5 text-xs font-medium select-none ${disabled ? 'text-slate-600 cursor-not-allowed' : 'text-slate-200 cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(role)}
                    disabled={disabled}
                    onChange={() => toggle(role)}
                    className="w-4 h-4 rounded accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                  {ROLE_LABEL[role]}
                </label>
                {supportsSchedule && scheduleId && currentRoles.has(role) && (
                  <button
                    onClick={() => setExpandedMembershipId(scheduleOpen ? null : scheduleId)}
                    title="Schedule"
                    className={`p-0.5 rounded cursor-pointer ${scheduleOpen ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Row 3 — save */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-xs font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
          {saveMsg ? (
            <span className={`text-xs font-medium ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveMsg.text}
            </span>
          ) : dirty ? (
            <span className="text-[11px] text-slate-500">Unsaved changes</span>
          ) : null}
        </div>
      </div>

      {editing && (
        <div className="px-3 pb-3">
          <UserProfileEditor
            centerId={centerId}
            membershipId={group.memberships[0].id}
            initial={{
              name: group.user.name ?? '',
              email: group.user.email ?? '',
              mobileNumber: group.user.mobileNumber ?? '',
            }}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onUserUpdated();
            }}
          />
        </div>
      )}

      {expandedMembershipId && (
        <div className="border-t border-white/[0.06] p-2.5 bg-black/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              {ROLE_LABEL[group.memberships.find(m => m.id === expandedMembershipId)!.role]} Schedule
            </span>
            <button onClick={() => setExpandedMembershipId(null)} className="text-slate-500"><X className="w-3.5 h-3.5" /></button>
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

/**
 * Inline editor for a member's basic profile fields — name, email,
 * mobile. Used from the Members tab when the admin clicks "Edit" on
 * a user row. PATCHes the membership endpoint with a `user:` block,
 * which writes through to the underlying User row.
 *
 * Targets one membership id (any of the user's roles will do — the
 * endpoint resolves the User from the membership and uniqueness-checks
 * email / mobile against the rest of the user base).
 */
function UserProfileEditor({
  centerId,
  membershipId,
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  membershipId: string;
  initial: { name: string; email: string; mobileNumber: string };
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [mobileNumber, setMobileNumber] = useState(initial.mobileNumber);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/members/${membershipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: {
            name: name.trim() || null,
            email: email.trim() || null,
            mobileNumber: mobileNumber.trim() || null,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-2 mb-1 p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-2"
    >
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent"
            placeholder="Full name"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent"
            placeholder="user@example.com"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Mobile</span>
          <input
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            className="mt-1 w-full bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent"
            placeholder="98xxxxxxxx"
          />
        </label>
      </div>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-md text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1 rounded-md bg-accent text-black text-xs font-semibold hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
      </div>
    </form>
  );
}
