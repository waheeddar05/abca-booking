'use client';

import { useState, useEffect } from 'react';
import { Package, Plus, Pencil, ToggleLeft, ToggleRight, Loader2, Users, BarChart3, Download, UserPlus, Search, Check, Calendar } from 'lucide-react';
import { NumberInputDialog } from '@/components/ui/NumberInputDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

interface PackageData {
  id: string;
  name: string;
  machineId: string | null;
  machineType: string;
  ballType: string;
  wicketType: string;
  timingType: string;
  totalSessions: number;
  validityDays: number;
  price: number;
  extraChargeRules: any;
  isActive: boolean;
  createdAt: string;
  _count?: { userPackages: number };
}

const MACHINE_OPTIONS = [
  { id: 'GRAVITY', label: 'Gravity (Leather)', type: 'LEATHER' },
  { id: 'YANTRA', label: 'Yantra (Premium Leather)', type: 'LEATHER' },
  { id: 'LEVERAGE_INDOOR', label: 'Leverage High Speed Tennis (Indoor)', type: 'TENNIS' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage High Speed Tennis (Outdoor)', type: 'TENNIS' },
];
const BALL_TYPES = ['MACHINE', 'LEATHER'];
const TIMING_TYPES = ['DAY', 'EVENING'];
const WICKET_TYPES = ['ASTRO', 'CEMENT', 'NATURAL'];

// All possible pitch upgrade paths
const ALL_WICKET_UPGRADE_PATHS = [
  { from: 'ASTRO', to: 'CEMENT', label: 'Astro Turf → Cement' },
  { from: 'ASTRO', to: 'NATURAL', label: 'Astro Turf → Natural Turf' },
  { from: 'CEMENT', to: 'NATURAL', label: 'Cement → Natural Turf' },
];

// All possible machine upgrade paths
const ALL_MACHINE_UPGRADE_PATHS = [
  { from: 'GRAVITY', to: 'YANTRA', label: 'Gravity → Yantra' },
  { from: 'YANTRA', to: 'GRAVITY', label: 'Yantra → Gravity' },
  { from: 'LEVERAGE_INDOOR', to: 'LEVERAGE_OUTDOOR', label: 'Leverage Indoor → Outdoor' },
  { from: 'LEVERAGE_OUTDOOR', to: 'LEVERAGE_INDOOR', label: 'Leverage Outdoor → Indoor' },
];

const defaultExtraChargeRules = {
  ballTypeUpgrade: 100,
  wicketTypeUpgrades: {} as Record<string, number>,
  machineUpgrades: {} as Record<string, number>,
  timingUpgrade: 125,
};

const emptyForm = {
  name: '',
  machineId: 'GRAVITY',
  machineType: 'LEATHER',
  ballType: 'LEATHER',
  wicketType: 'ASTRO',
  timingType: 'DAY',
  totalSessions: 4,
  validityDays: 30,
  price: '' as any,
  extraChargeRules: defaultExtraChargeRules,
  isActive: true,
};

export default function AdminPackages() {
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [tab, setTab] = useState<'packages' | 'users' | 'reports' | 'assign'>('packages');
  const [reports, setReports] = useState<any>(null);
  const [userPackages, setUserPackages] = useState<any[]>([]);
  const [userPkgStatusFilter, setUserPkgStatusFilter] = useState('');
  const [userPkgSearch, setUserPkgSearch] = useState('');
  const [userPkgSearchInput, setUserPkgSearchInput] = useState('');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [userPkgLoading, setUserPkgLoading] = useState(false);
  const [numberDialog, setNumberDialog] = useState<{
    title: string;
    label: string;
    placeholder: string;
    confirmLabel: string;
    variant?: 'default' | 'danger';
    onConfirm: (value: number) => void;
  } | null>(null);
  const [cancelPackageId, setCancelPackageId] = useState<string | null>(null);

  // CSV filter state
  const [csvFilters, setCsvFilters] = useState({
    status: '',
    packageId: '',
    fromDate: '',
    toDate: '',
  });
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  // Assign tab state
  const [assignSearch, setAssignSearch] = useState('');
  const [assignSearchResults, setAssignSearchResults] = useState<any[]>([]);
  const [assignSearching, setAssignSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [assignForm, setAssignForm] = useState({
    name: '',
    machineId: 'GRAVITY',
    machineType: 'LEATHER',
    ballType: 'LEATHER',
    wicketType: 'ASTRO',
    timingType: 'DAY',
    totalSessions: 4,
    validityDays: 30,
  });
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState({ text: '', type: '' });

  const searchUsers = async (query: string) => {
    if (!query || query.length < 2) { setAssignSearchResults([]); return; }
    setAssignSearching(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setAssignSearchResults(Array.isArray(data) ? data : data.users || []);
      }
    } catch (e) {
      console.error('User search failed', e);
    } finally {
      setAssignSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => searchUsers(assignSearch), 300);
    return () => clearTimeout(timer);
  }, [assignSearch]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) { setAssignMessage({ text: 'Please select a user', type: 'error' }); return; }
    if (!assignForm.name.trim()) { setAssignMessage({ text: 'Please enter a package name', type: 'error' }); return; }
    if (!assignForm.totalSessions || assignForm.totalSessions <= 0) { setAssignMessage({ text: 'Sessions must be a positive number', type: 'error' }); return; }
    if (!assignForm.validityDays || assignForm.validityDays <= 0) { setAssignMessage({ text: 'Validity days must be a positive number', type: 'error' }); return; }

    setAssigning(true);
    setAssignMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/packages/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, ...assignForm }),
      });
      if (res.ok) {
        setAssignMessage({ text: `Custom package assigned to ${selectedUser.name || selectedUser.mobileNumber || selectedUser.email}`, type: 'success' });
        setSelectedUser(null);
        setAssignSearch('');
        setAssignSearchResults([]);
        setAssignForm({ name: '', machineId: 'GRAVITY', machineType: 'LEATHER', ballType: 'LEATHER', wicketType: 'ASTRO', timingType: 'DAY', totalSessions: 4, validityDays: 30 });
      } else {
        const data = await res.json();
        setAssignMessage({ text: data.error || 'Failed to assign package', type: 'error' });
      }
    } catch {
      setAssignMessage({ text: 'Internal server error', type: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const params = new URLSearchParams();
      if (csvFilters.status) params.set('status', csvFilters.status);
      if (csvFilters.packageId) params.set('packageId', csvFilters.packageId);
      if (csvFilters.fromDate) params.set('fromDate', csvFilters.fromDate);
      if (csvFilters.toDate) params.set('toDate', csvFilters.toDate);
      const res = await fetch(`/api/admin/packages/reports/csv?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packages-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('CSV download failed', e);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/packages');
      if (res.ok) setPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch packages', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    setReportsLoading(true);
    try {
      const res = await fetch('/api/admin/packages/reports');
      if (res.ok) setReports(await res.json());
    } catch (e) {
      console.error('Failed to fetch reports', e);
    } finally {
      setReportsLoading(false);
    }
  };

  const fetchUserPackages = async (statusOverride?: string, searchOverride?: string) => {
    setUserPkgLoading(true);
    try {
      const params = new URLSearchParams();
      const status = statusOverride ?? userPkgStatusFilter;
      const search = searchOverride ?? userPkgSearch;
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const qs = params.toString();
      const res = await fetch(`/api/admin/packages/user-packages${qs ? `?${qs}` : ''}`);
      if (res.ok) setUserPackages(await res.json());
    } catch (e) {
      console.error('Failed to fetch user packages', e);
    } finally {
      setUserPkgLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (tab === 'reports') fetchReports();
    if (tab === 'users') fetchUserPackages();
  }, [tab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) {
      setMessage({ text: 'Please enter a valid price', type: 'error' });
      return;
    }
    try {
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId ? { ...form, price: Number(form.price), id: editingId } : { ...form, price: Number(form.price) };
      const res = await fetch('/api/admin/packages', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMessage({ text: editingId ? 'Package updated' : 'Package created', type: 'success' });
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        fetchPackages();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const toggleActive = async (pkg: PackageData) => {
    try {
      const res = await fetch('/api/admin/packages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.id, isActive: !pkg.isActive }),
      });
      if (res.ok) fetchPackages();
    } catch (e) {
      console.error('Toggle failed', e);
    }
  };

  const startEdit = (pkg: PackageData) => {
    const storedMachineId = pkg.machineId || (pkg.machineType === 'LEATHER' ? 'GRAVITY' : 'LEVERAGE_INDOOR');
    const rules = pkg.extraChargeRules || defaultExtraChargeRules;
    // Migrate old flat wicketTypeUpgrade to new wicketTypeUpgrades object
    let wicketTypeUpgrades = rules.wicketTypeUpgrades || {};
    if (!rules.wicketTypeUpgrades && rules.wicketTypeUpgrade) {
      // Legacy: convert flat value to all upgrade paths
      wicketTypeUpgrades = {};
      ALL_WICKET_UPGRADE_PATHS.forEach(p => { wicketTypeUpgrades[`${p.from}_TO_${p.to}`] = rules.wicketTypeUpgrade; });
    }
    const machineUpgrades = rules.machineUpgrades || {};
    setForm({
      name: pkg.name,
      machineId: storedMachineId,
      machineType: pkg.machineType,
      ballType: pkg.ballType === 'BOTH' ? 'LEATHER' : pkg.ballType,
      wicketType: pkg.wicketType || 'ASTRO',
      timingType: pkg.timingType === 'BOTH' ? 'DAY' : pkg.timingType,
      totalSessions: pkg.totalSessions,
      validityDays: pkg.validityDays,
      price: pkg.price,
      extraChargeRules: { ...rules, wicketTypeUpgrades, machineUpgrades },
      isActive: pkg.isActive,
    });
    setEditingId(pkg.id);
    setShowForm(true);
  };

  const handleUserAction = async (userPackageId: string, action: string, params: Record<string, any> = {}) => {
    try {
      const res = await fetch('/api/admin/packages/user-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPackageId, action, ...params }),
      });
      if (res.ok) {
        setMessage({ text: 'Action completed', type: 'success' });
        fetchUserPackages();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Action failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const labelMap: Record<string, string> = {
    LEATHER: 'Leather', TENNIS: 'Tennis', MACHINE: 'Machine Ball',
    BOTH: 'Both', CEMENT: 'Cement', ASTRO: 'Astro Turf', NATURAL: 'Natural Turf',
    DAY: 'Day (7:00 AM – 5:00 PM)', EVENING: 'Evening/Night (7:00 PM – 10:30 PM)',
    GRAVITY: 'Gravity (Leather)', YANTRA: 'Yantra (Premium Leather)',
    LEVERAGE_INDOOR: 'Leverage High Speed Tennis (Indoor)', LEVERAGE_OUTDOOR: 'Leverage High Speed Tennis (Outdoor)',
  };

  const isLeatherMachine = (machineId: string) => {
    const machine = MACHINE_OPTIONS.find(m => m.id === machineId);
    return machine?.type === 'LEATHER';
  };

  return (
    <div>
      <AdminPageHeader icon={Package} title="Packages" description="Manage subscription packages">
        <div className="flex gap-1 sm:gap-2">
          {(['packages', 'users', 'assign', 'reports'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${tab === t ? 'bg-accent/15 text-accent border border-accent/30' : 'text-slate-500 hover:bg-white/[0.06] border border-transparent'
                }`}
            >
              {t === 'packages' && <Package className="w-3.5 h-3.5 inline mr-1" />}
              {t === 'users' && <Users className="w-3.5 h-3.5 inline mr-1" />}
              {t === 'assign' && <UserPlus className="w-3.5 h-3.5 inline mr-1" />}
              {t === 'reports' && <BarChart3 className="w-3.5 h-3.5 inline mr-1" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </AdminPageHeader>

      {message.text && (
        <p className={`mb-4 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {/* PACKAGES TAB */}
      {tab === 'packages' && (
        <>
          <div className="mb-4">
            <button
              onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm); }}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {showForm ? 'Cancel' : 'Create Package'}
            </button>
          </div>

          {showForm && !editingId && (
            <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-5 mb-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                New Package
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Package Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="e.g. Monthly 4 Sessions"
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Machine</label>
                    <select
                      value={form.machineId}
                      onChange={e => {
                        const selected = MACHINE_OPTIONS.find(m => m.id === e.target.value);
                        setForm({
                          ...form,
                          machineId: e.target.value,
                          machineType: selected?.type || 'LEATHER',
                          // Reset ball type for tennis machines
                          ballType: selected?.type === 'TENNIS' ? 'BOTH' : form.ballType,
                        });
                      }}
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                    >
                      {MACHINE_OPTIONS.map(m => (
                        <option key={m.id} value={m.id} className="bg-[#1a2a40]">{m.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* Ball Type - only shown for leather machines (Gravity / Yantra) */}
                  {isLeatherMachine(form.machineId) && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Ball Type</label>
                      <select
                        value={form.ballType}
                        onChange={e => setForm({ ...form, ballType: e.target.value })}
                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                      >
                        {BALL_TYPES.map(t => <option key={t} value={t} className="bg-[#1a2a40]">{labelMap[t]}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Base Wicket/Pitch Type */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Base Pitch Type</label>
                    <div className="flex gap-2">
                      {WICKET_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setForm({ ...form, wicketType: t })}
                          className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-center ${form.wicketType === t
                              ? 'bg-accent text-primary shadow-sm'
                              : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                            }`}
                        >
                          {labelMap[t]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Timing</label>
                    <div className="flex gap-2">
                      {TIMING_TYPES.map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setForm({ ...form, timingType: t })}
                          className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${form.timingType === t
                              ? 'bg-accent text-primary shadow-sm'
                              : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                            }`}
                        >
                          <div>{t === 'DAY' ? 'Day' : 'Evening/Night'}</div>
                          <div className={`text-[9px] mt-0.5 ${form.timingType === t ? 'text-primary/70' : 'text-slate-500'}`}>
                            {t === 'DAY' ? '7:00 AM – 5:00 PM' : '7:00 PM – 10:30 PM'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Total Sessions</label>
                    <input
                      type="number"
                      min={1}
                      value={form.totalSessions}
                      onChange={e => setForm({ ...form, totalSessions: parseInt(e.target.value) || 1 })}
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Validity (days)</label>
                    <input
                      type="number"
                      min={1}
                      value={form.validityDays}
                      onChange={e => setForm({ ...form, validityDays: parseInt(e.target.value) || 30 })}
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Price (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={form.price === ('' as any) ? '' : form.price}
                      placeholder="Enter price"
                      onChange={e => {
                        const val = e.target.value;
                        setForm({ ...form, price: val === '' ? ('' as any) : parseFloat(val) });
                      }}
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent placeholder:text-slate-600"
                    />
                  </div>
                </div>

                {/* Extra Charge Rules */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-2">Extra Charge Rules (₹ per half-hour slot)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Ball Type Upgrade - only for leather machines */}
                    {isLeatherMachine(form.machineId) && (
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Ball Type Upgrade (Machine → Leather)</label>
                        <input
                          type="number"
                          min={0}
                          value={form.extraChargeRules.ballTypeUpgrade}
                          onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, ballTypeUpgrade: parseFloat(e.target.value) || 0 } })}
                          className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1">Timing Upgrade (Day → Evening)</label>
                      <input
                        type="number"
                        min={0}
                        value={form.extraChargeRules.timingUpgrade}
                        onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, timingUpgrade: parseFloat(e.target.value) || 0 } })}
                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  {/* Wicket/Pitch Type Upgrade Paths */}
                  <div className="mt-3">
                    <label className="block text-[10px] text-slate-500 mb-2">Pitch Upgrade Options (₹ per half-hour slot)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {ALL_WICKET_UPGRADE_PATHS.map(path => {
                        const key = `${path.from}_TO_${path.to}`;
                        return (
                          <div key={key} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]">
                            <label className="block text-[10px] text-accent/80 font-medium mb-1">{path.label}</label>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">₹</span>
                              <input
                                type="number"
                                min={0}
                                value={form.extraChargeRules.wicketTypeUpgrades?.[key] || 0}
                                onChange={e => setForm({
                                  ...form,
                                  extraChargeRules: {
                                    ...form.extraChargeRules,
                                    wicketTypeUpgrades: {
                                      ...form.extraChargeRules.wicketTypeUpgrades,
                                      [key]: parseFloat(e.target.value) || 0,
                                    },
                                  },
                                })}
                                placeholder="0"
                                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Machine Upgrade Options */}
                  <div className="mt-3">
                    <label className="block text-[10px] text-slate-500 mb-2">Machine Upgrade Options (₹ per half-hour slot)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ALL_MACHINE_UPGRADE_PATHS.map(path => {
                        const key = `${path.from}_TO_${path.to}`;
                        return (
                          <div key={key} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]">
                            <label className="block text-[10px] text-accent/80 font-medium mb-1">{path.label}</label>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">₹</span>
                              <input
                                type="number"
                                min={0}
                                value={form.extraChargeRules.machineUpgrades?.[key] || 0}
                                onChange={e => setForm({
                                  ...form,
                                  extraChargeRules: {
                                    ...form.extraChargeRules,
                                    machineUpgrades: {
                                      ...form.extraChargeRules.machineUpgrades,
                                      [key]: parseFloat(e.target.value) || 0,
                                    },
                                  },
                                })}
                                placeholder="0"
                                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {editingId ? 'Update Package' : 'Create Package'}
                </button>
              </form>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading packages...</span>
            </div>
          ) : packages.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
                <Package className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-sm text-slate-400">No packages created yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {packages.map(pkg => (
                <div key={pkg.id}>
                  <div className={`bg-white/[0.04] backdrop-blur-sm rounded-xl border ${editingId === pkg.id ? 'border-accent/30' : 'border-white/[0.08]'} hover:border-white/[0.12] transition-colors p-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-sm font-semibold text-white leading-tight">{pkg.name}</h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${pkg.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                            {pkg.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3 text-slate-500" />
                            {pkg.machineId ? labelMap[pkg.machineId] : `${labelMap[pkg.machineType]} Machine`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-500" />
                            {pkg.totalSessions} Sessions · {pkg.validityDays} Days Validity
                          </span>
                          <span className="text-sm font-bold text-accent">₹{pkg.price}</span>
                          {pkg._count && pkg._count.userPackages > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3 text-slate-500" />
                              {pkg._count.userPackages} purchased
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(pkg)}
                          className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleActive(pkg)}
                          className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                        >
                          {pkg.isActive ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5 text-slate-500" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Inline edit form below the selected package */}
                  {editingId === pkg.id && showForm && (
                    <div className="mt-1 bg-white/[0.04] backdrop-blur-sm rounded-xl border border-accent/20 p-5">
                      <h2 className="text-sm font-semibold text-white mb-3">Edit Package</h2>
                      <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Package Name</label>
                            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Monthly 4 Sessions" className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Machine</label>
                            <select value={form.machineId} onChange={e => { const selected = MACHINE_OPTIONS.find(m => m.id === e.target.value); setForm({ ...form, machineId: e.target.value, machineType: selected?.type || 'LEATHER', ballType: selected?.type === 'TENNIS' ? 'BOTH' : form.ballType }); }} className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent">
                              {MACHINE_OPTIONS.map(m => (<option key={m.id} value={m.id} className="bg-[#1a2a40]">{m.label}</option>))}
                            </select>
                          </div>
                          {isLeatherMachine(form.machineId) && (
                            <div>
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">Ball Type</label>
                              <select value={form.ballType} onChange={e => setForm({ ...form, ballType: e.target.value })} className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent">
                                {BALL_TYPES.map(t => <option key={t} value={t} className="bg-[#1a2a40]">{labelMap[t]}</option>)}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Base Pitch Type</label>
                            <div className="flex gap-2">
                              {WICKET_TYPES.map(t => (<button key={t} type="button" onClick={() => setForm({ ...form, wicketType: t })} className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer text-center ${form.wicketType === t ? 'bg-accent text-primary shadow-sm' : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'}`}>{labelMap[t]}</button>))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Timing</label>
                            <div className="flex gap-2">
                              {TIMING_TYPES.map(t => (<button key={t} type="button" onClick={() => setForm({ ...form, timingType: t })} className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${form.timingType === t ? 'bg-accent text-primary shadow-sm' : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'}`}><div>{t === 'DAY' ? 'Day' : 'Evening/Night'}</div></button>))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Total Sessions</label>
                            <input type="number" min={1} value={form.totalSessions} onChange={e => setForm({ ...form, totalSessions: parseInt(e.target.value) || 1 })} className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Validity (days)</label>
                            <input type="number" min={1} value={form.validityDays} onChange={e => setForm({ ...form, validityDays: parseInt(e.target.value) || 30 })} className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent" />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-400 mb-1">Price (₹)</label>
                            <input type="number" min={0} value={form.price === ('' as any) ? '' : form.price} placeholder="Enter price" onChange={e => { const val = e.target.value; setForm({ ...form, price: val === '' ? ('' as any) : parseFloat(val) }); }} className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent placeholder:text-slate-600" />
                          </div>
                        </div>

                        {/* Extra Charge Rules */}
                        <div>
                          <label className="block text-[11px] font-medium text-slate-400 mb-2">Extra Charge Rules (₹ per half-hour slot)</label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {isLeatherMachine(form.machineId) && (
                              <div>
                                <label className="block text-[10px] text-slate-500 mb-1">Ball Type Upgrade (Machine → Leather)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={form.extraChargeRules.ballTypeUpgrade}
                                  onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, ballTypeUpgrade: parseFloat(e.target.value) || 0 } })}
                                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                                />
                              </div>
                            )}
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-1">Timing Upgrade (Day → Evening)</label>
                              <input
                                type="number"
                                min={0}
                                value={form.extraChargeRules.timingUpgrade}
                                onChange={e => setForm({ ...form, extraChargeRules: { ...form.extraChargeRules, timingUpgrade: parseFloat(e.target.value) || 0 } })}
                                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent"
                              />
                            </div>
                          </div>

                          {/* Pitch Upgrade Options */}
                          <div className="mt-3">
                            <label className="block text-[10px] text-slate-500 mb-2">Pitch Upgrade Options (₹ per half-hour slot)</label>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {ALL_WICKET_UPGRADE_PATHS.map(path => {
                                const key = `${path.from}_TO_${path.to}`;
                                return (
                                  <div key={key} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]">
                                    <label className="block text-[10px] text-accent/80 font-medium mb-1">{path.label}</label>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-500">₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        value={form.extraChargeRules.wicketTypeUpgrades?.[key] || 0}
                                        onChange={e => setForm({
                                          ...form,
                                          extraChargeRules: {
                                            ...form.extraChargeRules,
                                            wicketTypeUpgrades: {
                                              ...form.extraChargeRules.wicketTypeUpgrades,
                                              [key]: parseFloat(e.target.value) || 0,
                                            },
                                          },
                                        })}
                                        placeholder="0"
                                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Machine Upgrade Options */}
                          <div className="mt-3">
                            <label className="block text-[10px] text-slate-500 mb-2">Machine Upgrade Options (₹ per half-hour slot)</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {ALL_MACHINE_UPGRADE_PATHS.map(path => {
                                const key = `${path.from}_TO_${path.to}`;
                                return (
                                  <div key={key} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]">
                                    <label className="block text-[10px] text-accent/80 font-medium mb-1">{path.label}</label>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-500">₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        value={form.extraChargeRules.machineUpgrades?.[key] || 0}
                                        onChange={e => setForm({
                                          ...form,
                                          extraChargeRules: {
                                            ...form.extraChargeRules,
                                            machineUpgrades: {
                                              ...form.extraChargeRules.machineUpgrades,
                                              [key]: parseFloat(e.target.value) || 0,
                                            },
                                          },
                                        })}
                                        placeholder="0"
                                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button type="submit" className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer">Update Package</button>
                          <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }} className="px-4 py-2.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer">Cancel</button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* USER PACKAGES TAB */}
      {tab === 'users' && (
        <>
          {/* Filter bar */}
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: '', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'EXPIRED', label: 'Expired' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setUserPkgStatusFilter(opt.value);
                    fetchUserPackages(opt.value, userPkgSearch);
                  }}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors cursor-pointer ${
                    userPkgStatusFilter === opt.value
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-white/[0.04] text-slate-400 border border-white/[0.07] hover:bg-white/[0.08]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <form
              className="flex-1 flex gap-1.5"
              onSubmit={e => {
                e.preventDefault();
                setUserPkgSearch(userPkgSearchInput);
                fetchUserPackages(userPkgStatusFilter, userPkgSearchInput);
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name, email or mobile..."
                  value={userPkgSearchInput}
                  onChange={e => setUserPkgSearchInput(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white rounded-lg pl-8 pr-3 py-1.5 text-[11px] outline-none focus:border-accent placeholder:text-slate-600"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-1.5 bg-accent/20 text-accent text-[11px] font-medium rounded-lg hover:bg-accent/30 transition-colors cursor-pointer"
              >
                Search
              </button>
              {userPkgSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setUserPkgSearchInput('');
                    setUserPkgSearch('');
                    fetchUserPackages(userPkgStatusFilter, '');
                  }}
                  className="px-2 py-1.5 text-slate-400 text-[11px] rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {userPkgLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading user packages...</span>
          </div>
        ) : userPackages.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-slate-400">No user packages found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {userPackages.map((up: any) => (
              <div key={up.id} className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-white truncate">{up.user?.name || up.user?.email || 'Unknown'}</span>
                      <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${up.status === 'ACTIVE' ? 'bg-green-500/15 text-green-400' :
                          up.status === 'EXPIRED' ? 'bg-red-500/15 text-red-400' :
                            'bg-slate-500/15 text-slate-400'
                        }`}>
                        {up.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-1">{up.package?.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>Used: {up.usedSessions}/{up.totalSessions}</span>
                      <span>Remaining: {up.totalSessions - up.usedSessions}</span>
                      <span>Expires: {new Date(up.expiryDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {up.status === 'ACTIVE' && (
                      <>
                        <button
                          onClick={() => setNumberDialog({
                            title: 'Extend Expiry',
                            label: 'Days to extend',
                            placeholder: 'e.g. 7',
                            confirmLabel: 'Extend',
                            onConfirm: (days) => { setNumberDialog(null); handleUserAction(up.id, 'EXTEND_EXPIRY', { days }); },
                          })}
                          className="px-2 py-1 text-[10px] bg-blue-500/15 text-blue-400 rounded-lg hover:bg-blue-500/25 cursor-pointer"
                          title="Add days to expiry"
                        >
                          +Days
                        </button>
                        <button
                          onClick={() => setNumberDialog({
                            title: 'Reduce Expiry',
                            label: 'Days to reduce',
                            placeholder: 'e.g. 3',
                            confirmLabel: 'Reduce',
                            variant: 'danger',
                            onConfirm: (days) => { setNumberDialog(null); handleUserAction(up.id, 'EXTEND_EXPIRY', { days: -days }); },
                          })}
                          className="px-2 py-1 text-[10px] bg-orange-500/15 text-orange-400 rounded-lg hover:bg-orange-500/25 cursor-pointer"
                          title="Reduce days from expiry"
                        >
                          -Days
                        </button>
                        <button
                          onClick={() => setNumberDialog({
                            title: 'Add Sessions',
                            label: 'Sessions to add',
                            placeholder: 'e.g. 5',
                            confirmLabel: 'Add',
                            onConfirm: (sessions) => { setNumberDialog(null); handleUserAction(up.id, 'ADD_SESSIONS', { sessions }); },
                          })}
                          className="px-2 py-1 text-[10px] bg-green-500/15 text-green-400 rounded-lg hover:bg-green-500/25 cursor-pointer"
                          title="Increase total sessions"
                        >
                          +Sessions
                        </button>
                        <button
                          onClick={() => setNumberDialog({
                            title: 'Reduce Sessions',
                            label: 'Sessions to reduce',
                            placeholder: 'e.g. 2',
                            confirmLabel: 'Reduce',
                            variant: 'danger',
                            onConfirm: (sessions) => { setNumberDialog(null); handleUserAction(up.id, 'REDUCE_SESSIONS', { sessions }); },
                          })}
                          className="px-2 py-1 text-[10px] bg-yellow-500/15 text-yellow-400 rounded-lg hover:bg-yellow-500/25 cursor-pointer"
                          title="Decrease total sessions"
                        >
                          -Sessions
                        </button>
                        <button
                          onClick={() => setCancelPackageId(up.id)}
                          className="px-2 py-1 text-[10px] bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
      )}

      {/* ASSIGN TAB */}
      {tab === 'assign' && (
        <div className="space-y-4">
          {assignMessage.text && (
            <p className={`text-sm ${assignMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {assignMessage.text}
            </p>
          )}

          {/* User Search */}
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Search className="w-4 h-4 text-accent" />
              Select User
            </h3>
            {selectedUser ? (
              <div className="flex items-center justify-between bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
                <div>
                  <span className="text-sm font-semibold text-white">{selectedUser.name || 'No name'}</span>
                  <span className="text-xs text-slate-400 ml-2">{selectedUser.mobileNumber || selectedUser.email}</span>
                </div>
                <button
                  onClick={() => { setSelectedUser(null); setAssignSearch(''); setAssignSearchResults([]); }}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <input
                    type="text"
                    value={assignSearch}
                    onChange={e => setAssignSearch(e.target.value)}
                    placeholder="Search by name, mobile, or email..."
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-accent placeholder:text-slate-500"
                  />
                  {assignSearching && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-3 top-3.5" />}
                </div>
                {assignSearchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                    {assignSearchResults.map((u: any) => (
                      <button
                        key={u.id}
                        onClick={() => { setSelectedUser(u); setAssignSearchResults([]); setAssignSearch(''); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
                      >
                        <span className="text-sm text-white">{u.name || 'No name'}</span>
                        <span className="text-xs text-slate-400 ml-2">{u.mobileNumber || u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Package Config Form */}
          <form onSubmit={handleAssign} className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4 space-y-4">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Package className="w-4 h-4 text-accent" />
              Package Details
            </h3>

            <div>
              <label className="block text-[10px] font-medium text-slate-400 mb-1">Package Name</label>
              <input
                type="text"
                value={assignForm.name}
                onChange={e => setAssignForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Custom 10 Sessions for John"
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-accent placeholder:text-slate-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Machine</label>
                <select
                  value={assignForm.machineId}
                  onChange={e => {
                    const m = MACHINE_OPTIONS.find(o => o.id === e.target.value);
                    setAssignForm(prev => ({
                      ...prev,
                      machineId: e.target.value,
                      machineType: m?.type || prev.machineType,
                      ballType: m?.type === 'TENNIS' ? 'MACHINE' : prev.ballType,
                    }));
                  }}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-3 py-3 outline-none focus:border-accent"
                >
                  {MACHINE_OPTIONS.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Ball Type</label>
                <select
                  value={assignForm.ballType}
                  onChange={e => setAssignForm(prev => ({ ...prev, ballType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-3 py-3 outline-none focus:border-accent"
                  disabled={assignForm.machineType === 'TENNIS'}
                >
                  {BALL_TYPES.map(b => (
                    <option key={b} value={b}>{b === 'MACHINE' ? 'Machine Ball' : 'Leather'}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Pitch Type</label>
                <select
                  value={assignForm.wicketType}
                  onChange={e => setAssignForm(prev => ({ ...prev, wicketType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-3 py-3 outline-none focus:border-accent"
                >
                  {WICKET_TYPES.map(w => (
                    <option key={w} value={w}>{w === 'ASTRO' ? 'Astro Turf' : w === 'CEMENT' ? 'Cement' : 'Natural Turf'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Timing</label>
                <select
                  value={assignForm.timingType}
                  onChange={e => setAssignForm(prev => ({ ...prev, timingType: e.target.value }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-3 py-3 outline-none focus:border-accent"
                >
                  {TIMING_TYPES.map(t => (
                    <option key={t} value={t}>{t === 'DAY' ? 'Day' : 'Evening'}</option>
                  ))}
                  <option value="BOTH">Both</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Total Sessions</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.totalSessions}
                  onChange={e => setAssignForm(prev => ({ ...prev, totalSessions: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-400 mb-1">Validity (Days)</label>
                <input
                  type="number"
                  min={1}
                  value={assignForm.validityDays}
                  onChange={e => setAssignForm(prev => ({ ...prev, validityDays: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-accent"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={assigning || !selectedUser}
              className="w-full bg-accent hover:bg-accent-light text-primary font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {assigning ? 'Assigning...' : 'Assign Custom Package'}
            </button>
          </form>
        </div>
      )}

      {/* REPORTS TAB */}
      {tab === 'reports' && (
        reportsLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading reports...</span>
          </div>
        ) : reports ? (
          <div className="space-y-5">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Active Packages', value: reports.activePackages },
                { label: 'Expired Packages', value: reports.expiredPackages },
                { label: 'Total Sessions Sold', value: reports.totalSessionsSold },
                { label: 'Sessions Consumed', value: reports.totalSessionsConsumed },
                { label: 'Extra Charges', value: `₹${reports.extraChargesCollected || 0}` },
                { label: 'Total Revenue', value: `₹${reports.totalRevenue || 0}` },
              ].map(stat => (
                <div key={stat.label} className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4">
                  <p className="text-[11px] text-slate-400 mb-1">{stat.label}</p>
                  <p className="text-lg font-bold text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* CSV Export with Filters */}
            <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-4">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Download className="w-4 h-4 text-accent" />
                Export Packages Report
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Status</label>
                  <select
                    value={csvFilters.status}
                    onChange={e => setCsvFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-2 py-2 outline-none focus:border-accent"
                  >
                    <option value="">All</option>
                    <option value="ACTIVE">Active</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Package</label>
                  <select
                    value={csvFilters.packageId}
                    onChange={e => setCsvFilters(prev => ({ ...prev, packageId: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-2 py-2 outline-none focus:border-accent"
                  >
                    <option value="">All Packages</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">From Date</label>
                  <input
                    type="date"
                    value={csvFilters.fromDate}
                    onChange={e => setCsvFilters(prev => ({ ...prev, fromDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-2 py-2 outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">To Date</label>
                  <input
                    type="date"
                    value={csvFilters.toDate}
                    onChange={e => setCsvFilters(prev => ({ ...prev, toDate: e.target.value }))}
                    className="w-full bg-white/[0.04] border border-white/[0.1] text-white text-sm rounded-lg px-2 py-2 outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadCsv}
                  disabled={downloadingCsv}
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {downloadingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download CSV
                </button>
                {(csvFilters.status || csvFilters.packageId || csvFilters.fromDate || csvFilters.toDate) && (
                  <button
                    onClick={() => setCsvFilters({ status: '', packageId: '', fromDate: '', toDate: '' })}
                    className="text-xs text-slate-400 hover:text-white px-3 py-2 cursor-pointer"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-16">No report data</p>
        )
      )}

      <NumberInputDialog
        open={!!numberDialog}
        title={numberDialog?.title || ''}
        label={numberDialog?.label || ''}
        placeholder={numberDialog?.placeholder}
        confirmLabel={numberDialog?.confirmLabel}
        variant={numberDialog?.variant}
        onConfirm={(v) => numberDialog?.onConfirm(v)}
        onCancel={() => setNumberDialog(null)}
      />
      <ConfirmDialog
        open={!!cancelPackageId}
        title="Cancel Package"
        message="Are you sure you want to cancel this package? This action cannot be undone."
        confirmLabel="Cancel Package"
        variant="danger"
        onConfirm={() => { const id = cancelPackageId; setCancelPackageId(null); if (id) handleUserAction(id, 'CANCEL'); }}
        onCancel={() => setCancelPackageId(null)}
      />
    </div>
  );
}
