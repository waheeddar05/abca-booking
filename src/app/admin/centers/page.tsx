'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Building2, Plus, Loader2, MapPin, Users, Settings2, ArrowRight, X } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';

type CenterRow = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
  city: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  razorpayKeyId: string | null;
  _count: {
    memberships: number;
    machines: number;
    resources: number;
    bookings: number;
  };
};

export default function CentersListPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const isSuperAdmin = (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin === true;

  const [centers, setCenters] = useState<CenterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && !isSuperAdmin) router.replace('/admin');
  }, [status, isSuperAdmin, router]);

  const fetchCenters = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/centers');
      if (res.ok) setCenters(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) fetchCenters();
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="p-6 text-slate-400">Super admin access required.</div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        icon={Building2}
        title="Centers"
        description="Manage all PlayOrbit centers, machines, resources, admins, and per-center config."
      >
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:bg-accent/90 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" /> New center
        </button>
      </AdminPageHeader>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : centers.length === 0 ? (
        <AdminCard>
          <div className="p-6 text-center text-slate-400 text-sm">
            No centers yet. Click <strong>New center</strong> above to create one.
          </div>
        </AdminCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {centers.map((c) => (
            <Link
              key={c.id}
              href={`/admin/centers/${c.id}`}
              className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-accent/40 hover:bg-white/[0.04] transition-all p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white truncate">{c.name}</h3>
                    {!c.isActive && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                        inactive
                      </span>
                    )}
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                      {c.slug}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {c.city || '—'}
                    <span className="mx-1">·</span>
                    <span>{c.bookingModel === 'RESOURCE_BASED' ? 'Resource-based' : 'Machine/Pitch'}</span>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-accent transition-colors flex-shrink-0" />
              </div>

              <div className="grid grid-cols-4 gap-2 text-[11px]">
                <Stat label="Members" value={c._count.memberships} icon={<Users className="w-3 h-3" />} />
                <Stat label="Machines" value={c._count.machines} icon={<Settings2 className="w-3 h-3" />} />
                <Stat label="Resources" value={c._count.resources} icon={<Building2 className="w-3 h-3" />} />
                <Stat label="Bookings" value={c._count.bookings} />
              </div>

              <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                <span className={`w-2 h-2 rounded-full ${c.razorpayKeyId ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                Razorpay {c.razorpayKeyId ? 'configured' : 'using env fallback'}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewCenterDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.push(`/admin/centers/${id}`);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2 py-1.5">
      <div className="flex items-center gap-1 text-slate-500 text-[9px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

function NewCenterDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    slug: '',
    name: '',
    shortName: '',
    bookingModel: 'MACHINE_PITCH' as 'MACHINE_PITCH' | 'RESOURCE_BASED',
    city: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.slug.trim().toLowerCase(),
          name: form.name.trim(),
          shortName: form.shortName.trim() || null,
          bookingModel: form.bookingModel,
          city: form.city.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || 'Failed to create');
        return;
      }
      onCreated(data.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-[#0b1726] border border-white/[0.08] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-white">New Center</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <Field label="Name" required>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="Toplay Cricket Arena"
            />
          </Field>
          <Field label="Slug" required help="URL-safe identifier. Lowercase letters, digits, hyphens. Cannot be changed later.">
            <input
              required
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="input"
              placeholder="toplay"
              pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
            />
          </Field>
          <Field label="Short name (optional)">
            <input
              value={form.shortName}
              onChange={(e) => setForm({ ...form, shortName: e.target.value })}
              className="input"
              placeholder="Toplay"
            />
          </Field>
          <Field label="City (optional)">
            <input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="input"
              placeholder="Bengaluru"
            />
          </Field>
          <Field label="Booking model" help="Machine/Pitch is the legacy model used by ABCA. Resource-based is for new centers with named nets and staff.">
            <select
              value={form.bookingModel}
              onChange={(e) => setForm({ ...form, bookingModel: e.target.value as 'MACHINE_PITCH' | 'RESOURCE_BASED' })}
              className="input"
            >
              <option value="MACHINE_PITCH">Machine / Pitch (legacy)</option>
              <option value="RESOURCE_BASED">Resource-based (nets + staff)</option>
            </select>
          </Field>

          {err && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{err}</div>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-xl text-sm text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold bg-accent text-black hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.625rem;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 0.875rem;
          color: white;
          outline: none;
        }
        :global(.input:focus) {
          border-color: rgba(56, 189, 248, 0.6);
          background: rgba(255, 255, 255, 0.06);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </div>
      {children}
      {help && <div className="text-[11px] text-slate-500 mt-1">{help}</div>}
    </label>
  );
}
