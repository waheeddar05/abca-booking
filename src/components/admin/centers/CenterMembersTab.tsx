'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, X, UserPlus, Mail, Phone } from 'lucide-react';
import { Field, TextInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type MembershipRole = 'ADMIN' | 'OPERATOR' | 'COACH' | 'SIDEARM_STAFF';

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
  SIDEARM_STAFF: 'Sidearm staff',
};

const ROLE_COLOR: Record<MembershipRole, string> = {
  ADMIN: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  OPERATOR: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  COACH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SIDEARM_STAFF: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
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
            <option value="SIDEARM_STAFF">Sidearm staff</option>
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
            <div key={m.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{m.user.name || '(no name)'}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${ROLE_COLOR[m.role]}`}>
                    {ROLE_LABEL[m.role]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                  {m.user.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {m.user.email}
                    </span>
                  )}
                  {m.user.mobileNumber && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {m.user.mobileNumber}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => remove(m.id)}
                className="p-2 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer flex-shrink-0"
                title="Remove from center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
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
            <option value="SIDEARM_STAFF">Sidearm staff</option>
          </SelectInput>
        </Field>
        <Field
          label="Email or mobile"
          required
          help="ADMIN/OPERATOR must already have signed in. COACH/SIDEARM_STAFF will be created if not found."
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
