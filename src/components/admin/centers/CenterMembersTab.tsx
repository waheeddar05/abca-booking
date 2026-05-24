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

  // Grant an additional role to a user who is already a member of this
  // center. Used by the inline "+ Add role" chip on each row so the
  // admin doesn't have to go back to "Assign user" → search → pick the
  // same person again just to give them one more role. Returns null on
  // success or an error string on failure (so the row can show it
  // locally instead of stealing focus with the top-level banner).
  const addRole = async (userId: string, role: MembershipRole): Promise<string | null> => {
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roles: [role] }),
      });
      if (res.ok) {
        await refresh();
        return null;
      }
      const data = await res.json().catch(() => ({}));
      return data?.error || `Add failed (HTTP ${res.status})`;
    } catch (e) {
      return e instanceof Error ? e.message : 'Add failed';
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
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <SelectInput
            value={filter}
            onChange={(e) => setFilter(e.target.value as MembershipRole | 'ALL')}
            className="!w-auto !py-1.5 !text-xs"
          >
            <option value="ALL">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="OPERATOR">Operators</option>
            <option value="COACH">Coaches</option>
            <option value="SIDEARM_SPECIALIST">Sidearm</option>
            <option value="GROUND_STAFF">Ground</option>
          </SelectInput>
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }} className="flex items-center gap-1.5 flex-1 min-w-[200px]">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search..."
              className="flex-1 !py-1.5 !text-xs"
            />
            <SecondaryButton type="submit" className="px-2.5 py-1.5 text-xs">Search</SecondaryButton>
          </form>
        </div>
        <PrimaryButton onClick={() => setShowNew(true)} className="!px-2.5 !py-1 !text-[10px] rounded-md">
          <UserPlus className="w-3.5 h-3.5" /> Assign
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
              isSuperAdmin={isSuperAdmin}
              onRemoveRole={remove}
              onRemoveUser={removeUserEntirely}
              onAddRole={addRole}
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

      <div className="flex items-center justify-between">
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
          {manualMode ? '← Back to user search' : 'Add new user instead →'}
        </button>
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
  isSuperAdmin,
  onRemoveRole,
  onRemoveUser,
  onAddRole,
  onUserUpdated,
}: {
  centerId: string;
  group: { userId: string; user: MembershipRow['user']; memberships: MembershipRow[] };
  isSuperAdmin: boolean;
  onRemoveRole: (membershipId: string) => void;
  onRemoveUser: (userId: string) => void;
  onAddRole: (userId: string, role: MembershipRole) => Promise<string | null>;
  onUserUpdated: () => void;
}) {
  const [expandedMembershipId, setExpandedMembershipId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [savingRole, setSavingRole] = useState<MembershipRole | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const currentRoles = new Set<MembershipRole>(group.memberships.map((m) => m.role));
  const ALL_ROLES: MembershipRole[] = ['ADMIN', 'OPERATOR', 'COACH', 'SIDEARM_SPECIALIST', 'GROUND_STAFF'];
  const assignableRoles = ALL_ROLES.filter(
    (r) => !currentRoles.has(r) && (isSuperAdmin || r !== 'ADMIN'),
  );

  const handleAddRole = async (role: MembershipRole) => {
    setSavingRole(role);
    setAddError(null);
    const err = await onAddRole(group.userId, role);
    setSavingRole(null);
    if (err) {
      setAddError(err);
      return;
    }
    setAddingRole(false);
  };

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white truncate">
                {group.user.name || group.user.email || group.user.mobileNumber || '(no name)'}
              </span>
              <div className="flex gap-1 shrink-0">
                {group.user.email && (
                  <span title={group.user.email}>
                    <Mail className="w-3 h-3 text-slate-500" />
                  </span>
                )}
                {group.user.mobileNumber && (
                  <span title={group.user.mobileNumber}>
                    <Phone className="w-3 h-3 text-slate-500" />
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {group.memberships.map((m) => {
                const supportsSchedule = m.role === 'COACH' || m.role === 'SIDEARM_SPECIALIST';
                const expanded = expandedMembershipId === m.id;
                return (
                  <span
                    key={m.id}
                    className={`inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-full border text-[9px] uppercase tracking-wide ${ROLE_COLOR[m.role]}`}
                  >
                    {ROLE_LABEL[m.role]}
                    {supportsSchedule && (
                      <button
                        onClick={() => setExpandedMembershipId(expanded ? null : m.id)}
                        className={`ml-0.5 p-0.5 rounded-full cursor-pointer ${
                          expanded ? 'bg-white/15' : 'hover:bg-white/10'
                        }`}
                        title="Schedule"
                      >
                        <CalendarClock className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => onRemoveRole(m.id)}
                      className="p-0.5 rounded-full hover:bg-red-500/20 cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
              {assignableRoles.length > 0 && !addingRole && (
                <button
                  onClick={() => setAddingRole(true)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-dashed border-white/10 text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  <Plus className="w-2.5 h-2.5" /> Role
                </button>
              )}
              {addingRole && (
                <div className="flex items-center gap-1">
                  {assignableRoles.map(r => (
                    <button
                      key={r}
                      onClick={() => handleAddRole(r)}
                      disabled={!!savingRole}
                      className={`text-[9px] px-1.5 py-0.5 rounded-full border ${ROLE_COLOR[r]} cursor-pointer`}
                    >
                      {savingRole === r ? '...' : r}
                    </button>
                  ))}
                  <button onClick={() => setAddingRole(false)} className="p-0.5 text-slate-500 cursor-pointer"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing(!editing)}
            className={`p-1.5 rounded-lg border text-slate-400 hover:text-white cursor-pointer ${editing ? 'bg-accent/10 border-accent/30 text-accent' : 'border-transparent'}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onRemoveUser(group.userId)}
            className="p-1.5 rounded-lg border border-transparent text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="px-2.5 pb-2.5">
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
