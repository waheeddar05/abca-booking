'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Building2, ArrowLeft, Loader2, Trash2, MapPin, CreditCard, Users, Settings2, FileText, SlidersHorizontal } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminCard } from '@/components/admin/AdminCard';
import { CenterGeneralTab, type CenterDetail } from '@/components/admin/centers/CenterGeneralTab';
import { CenterPaymentTab } from '@/components/admin/centers/CenterPaymentTab';
import { CenterMachinesTab } from '@/components/admin/centers/CenterMachinesTab';
import { CenterResourcesTab } from '@/components/admin/centers/CenterResourcesTab';
import { CenterMembersTab } from '@/components/admin/centers/CenterMembersTab';
import { CenterPoliciesTab } from '@/components/admin/centers/CenterPoliciesTab';

type TabKey = 'general' | 'payment' | 'machines' | 'resources' | 'members' | 'policies';

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'general', label: 'General', icon: MapPin },
  { key: 'payment', label: 'Payment', icon: CreditCard },
  { key: 'machines', label: 'Machines', icon: Settings2 },
  { key: 'resources', label: 'Resources', icon: Building2 },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'policies', label: 'Policies', icon: SlidersHorizontal },
];

type DetailWithCounts = CenterDetail & {
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  _count: { memberships: number; machines: number; resources: number; bookings: number };
};

export default function CenterEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, status } = useSession();
  const isSuperAdmin = (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin === true;

  const [center, setCenter] = useState<DetailWithCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('general');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && !isSuperAdmin) router.replace('/admin');
  }, [status, isSuperAdmin, router]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/centers/${id}`);
        if (!res.ok) {
          if (active) setError(res.status === 404 ? 'Center not found' : 'Failed to load center');
          return;
        }
        const data = await res.json();
        if (active) setCenter(data);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, isSuperAdmin]);

  if (!isSuperAdmin) {
    return <div className="p-6 text-slate-400">Super admin access required.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (error || !center) {
    return (
      <div>
        <AdminPageHeader icon={Building2} title="Center" />
        <AdminCard>
          <div className="p-6 text-center text-red-400 text-sm">{error || 'Not found'}</div>
        </AdminCard>
      </div>
    );
  }

  const deactivate = async () => {
    if (!confirm(`Deactivate "${center.name}"? Users and admins lose access here. You can reactivate later via PATCH.`)) return;
    const res = await fetch(`/api/admin/centers/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/admin/centers');
    } else {
      const data = await res.json();
      alert(data?.error || 'Failed to deactivate');
    }
  };

  return (
    <div>
      <div className="mb-3">
        <Link
          href="/admin/centers"
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-3 h-3" /> All centers
        </Link>
      </div>

      <AdminPageHeader
        icon={Building2}
        title={center.name}
        description={`Slug: ${center.slug} · ${center.bookingModel === 'RESOURCE_BASED' ? 'Resource-based' : 'Machine/Pitch'} · ${center._count.memberships} member(s) · ${center._count.machines} machine(s) · ${center._count.resources} resource(s)`}
      >
        {center.isActive && (
          <button
            onClick={deactivate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Deactivate
          </button>
        )}
      </AdminPageHeader>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-4 border-b border-white/[0.06] no-scrollbar">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                active
                  ? 'bg-accent/10 text-accent border-b-2 border-accent'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <AdminCard>
        <div className="p-4">
          {tab === 'general' && (
            <CenterGeneralTab
              center={center}
              onSaved={(updated) => setCenter({ ...center, ...updated })}
            />
          )}
          {tab === 'payment' && (
            <CenterPaymentTab
              center={center}
              onSaved={(updated) => setCenter({ ...center, ...updated })}
            />
          )}
          {tab === 'machines' && <CenterMachinesTab centerId={id} />}
          {tab === 'resources' && <CenterResourcesTab centerId={id} />}
          {tab === 'members' && <CenterMembersTab centerId={id} />}
          {tab === 'policies' && <CenterPoliciesTab centerId={id} />}
        </div>
      </AdminCard>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
