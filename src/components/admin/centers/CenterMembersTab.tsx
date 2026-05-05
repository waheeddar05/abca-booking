'use client';

import { useEffect, useState } from 'react';
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
    if (!confirm('Deactivate this membership? The user keeps their account but loses access here.')) return;
    const res = await fetch(`/api/admin/centers/${centerId}/members/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
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
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : members.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">No members yet.</div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              centerId={centerId}
              member={m}
              onRemove={() => remove(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewMembershipForm({
  centerId,
  onCancel,
  onSaved,
}: {
  centerId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<MembershipRole>('ADMIN');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const trimmed = identifier.trim();
      const isEmail = trimmed.includes('@');
      const body: Record<string, unknown> = { role };
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

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Role" required>
          <SelectInput value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
            <option value="ADMIN">Admin</option>
            <option value="OPERATOR">Operator</option>
            <option value="COACH">Coach</option>
            <option value="SIDEARM_SPECIALIST">Sidearm Specialist</option>
          </SelectInput>
        </Field>
        <Field
          label="Email or mobile"
          required
          help="ADMIN/OPERATOR must already have signed in. COACH/SIDEARM_SPECIALIST will be created if not found."
        >
          <TextInput required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="user@example.com / 9876543210" />
        </Field>
        <Field label="Name (only for new coach/staff)">
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
          Assign
        </PrimaryButton>
      </div>
    </form>
  );
}

// ─── MemberRow + Availability editor ────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function MemberRow({
  centerId,
  member,
  onRemove,
}: {
  centerId: string;
  member: MembershipRow;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Coaches and specialists can have a weekly schedule. Admin / operator
  // memberships are always-on by definition, so no "Schedule" button.
  const supportsSchedule = member.role === 'COACH' || member.role === 'SIDEARM_SPECIALIST';

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{member.user.name || '(no name)'}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${ROLE_COLOR[member.role]}`}>
              {ROLE_LABEL[member.role]}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
            {member.user.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" /> {member.user.email}
              </span>
            )}
            {member.user.mobileNumber && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" /> {member.user.mobileNumber}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {supportsSchedule && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`p-2 rounded-lg cursor-pointer ${
                expanded ? 'bg-accent/10 text-accent' : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
              }`}
              title="Edit weekly schedule"
            >
              <CalendarClock className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-2 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
            title="Remove from center"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {supportsSchedule && expanded && (
        <div className="border-t border-white/[0.06] p-3">
          <AvailabilityEditor centerId={centerId} membershipId={member.id} />
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
