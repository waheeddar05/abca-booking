'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { CalendarCheck, Activity, UserPlus, CalendarDays, Settings, Clock, IndianRupee, TrendingUp, Percent, Save, Loader2, Zap } from 'lucide-react';

interface Stats {
  totalBookings: number;
  activeAdmins: number;
  todayBookings: number;
  upcomingBookings: number;
  lastMonthBookings: number;
  totalSlots: number;
  totalRevenue: number;
  totalDiscount: number;
  systemStatus: string;
}

interface DiscountConfig {
  enabled: boolean;
  minSlots: number;
  discountType: string;
  discountValue: number;
  defaultSlotPrice: number;
}

interface MachineConfig {
  leatherMachine: {
    ballTypeSelectionEnabled: boolean;
    leatherBallExtraCharge: number;
    machineBallExtraCharge: number;
  };
  tennisMachine: {
    pitchTypeSelectionEnabled: boolean;
    astroPitchPrice: number;
    turfPitchPrice: number;
  };
  numberOfOperators: number;
}

export default function AdminDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [discountConfig, setDiscountConfig] = useState<DiscountConfig>({
    enabled: false,
    minSlots: 2,
    discountType: 'PERCENTAGE',
    discountValue: 0,
    defaultSlotPrice: 600,
  });
  const [discountLoading, setDiscountLoading] = useState(true);
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [discountMessage, setDiscountMessage] = useState({ text: '', type: '' });

  const [machineConfig, setMachineConfig] = useState<MachineConfig>({
    leatherMachine: { ballTypeSelectionEnabled: false, leatherBallExtraCharge: 100, machineBallExtraCharge: 0 },
    tennisMachine: { pitchTypeSelectionEnabled: false, astroPitchPrice: 600, turfPitchPrice: 700 },
    numberOfOperators: 1,
  });
  const [machineLoading, setMachineLoading] = useState(true);
  const [savingMachine, setSavingMachine] = useState(false);
  const [machineMessage, setMachineMessage] = useState({ text: '', type: '' });

  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }

    async function fetchDiscountConfig() {
      try {
        const response = await fetch('/api/admin/discount-config');
        if (response.ok) {
          const data = await response.json();
          setDiscountConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch discount config:', error);
      } finally {
        setDiscountLoading(false);
      }
    }

    async function fetchMachineConfig() {
      try {
        const response = await fetch('/api/admin/machine-config');
        if (response.ok) {
          const data = await response.json();
          setMachineConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch machine config:', error);
      } finally {
        setMachineLoading(false);
      }
    }

    fetchStats();
    fetchDiscountConfig();
    fetchMachineConfig();
  }, []);

  const handleSaveDiscount = async () => {
    setSavingDiscount(true);
    setDiscountMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/discount-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discountConfig),
      });
      if (res.ok) {
        setDiscountMessage({ text: 'Discount configuration saved', type: 'success' });
      } else {
        const data = await res.json();
        setDiscountMessage({ text: data.error || 'Failed to save', type: 'error' });
      }
    } catch {
      setDiscountMessage({ text: 'Failed to save configuration', type: 'error' });
    } finally {
      setSavingDiscount(false);
    }
  };

  const handleSaveMachine = async () => {
    setSavingMachine(true);
    setMachineMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/machine-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(machineConfig),
      });
      if (res.ok) {
        setMachineMessage({ text: 'Machine configuration saved', type: 'success' });
      } else {
        const data = await res.json();
        setMachineMessage({ text: data.error || 'Failed to save', type: 'error' });
      }
    } catch {
      setMachineMessage({ text: 'Failed to save configuration', type: 'error' });
    } finally {
      setSavingMachine(false);
    }
  };

  const statCards = [
    { label: 'Total Bookings', value: stats?.totalBookings ?? 0, icon: CalendarCheck, color: 'text-primary', bg: 'bg-primary/5' },
    { label: 'Today', value: stats?.todayBookings ?? 0, icon: CalendarDays, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Upcoming', value: stats?.upcomingBookings ?? 0, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Total Slots', value: stats?.totalSlots ?? 0, icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Revenue', value: stats?.totalRevenue ? `₹${stats.totalRevenue.toLocaleString()}` : '₹0', icon: IndianRupee, color: 'text-green-600', bg: 'bg-green-50', isText: true },
    { label: 'System Status', value: stats?.systemStatus ?? 'Healthy', icon: Activity, color: 'text-green-600', bg: 'bg-green-50', isText: true },
  ];

  const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-5">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{card.label}</p>
                <p className={`text-xl font-bold ${card.isText ? card.color : 'text-gray-900'}`}>
                  {loading ? '...' : card.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <Link href="/admin/users" className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors">
              <UserPlus className="w-4 h-4" />
              Invite Admin
            </Link>
          )}
          <Link href="/admin/bookings" className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            <CalendarDays className="w-4 h-4" />
            View Bookings
          </Link>
          <Link href="/admin/slots" className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            <Clock className="w-4 h-4" />
            Manage Slots
          </Link>
          <Link href="/admin/policies" className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            <Settings className="w-4 h-4" />
            Manage Policies
          </Link>
        </div>
      </div>

      {/* Machine Configuration */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-semibold text-gray-900">Machine Configuration</h2>
        </div>

        {machineLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading configuration...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Leather Ball Machine */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Leather Ball Machine</h3>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Enable Ball Type Selection</p>
                  <p className="text-xs text-gray-400">Users choose between Leather Ball and Machine Ball</p>
                </div>
                <button
                  onClick={() => setMachineConfig(prev => ({
                    ...prev,
                    leatherMachine: { ...prev.leatherMachine, ballTypeSelectionEnabled: !prev.leatherMachine.ballTypeSelectionEnabled },
                  }))}
                  className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${
                    machineConfig.leatherMachine.ballTypeSelectionEnabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    machineConfig.leatherMachine.ballTypeSelectionEnabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {machineConfig.leatherMachine.ballTypeSelectionEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">Leather Ball Extra Charge</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input
                        type="number"
                        value={machineConfig.leatherMachine.leatherBallExtraCharge}
                        onChange={e => setMachineConfig(prev => ({
                          ...prev,
                          leatherMachine: { ...prev.leatherMachine, leatherBallExtraCharge: Number(e.target.value) },
                        }))}
                        min="0"
                        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">Machine Ball Extra Charge</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input
                        type="number"
                        value={machineConfig.leatherMachine.machineBallExtraCharge}
                        onChange={e => setMachineConfig(prev => ({
                          ...prev,
                          leatherMachine: { ...prev.leatherMachine, machineBallExtraCharge: Number(e.target.value) },
                        }))}
                        min="0"
                        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tennis Ball Machine */}
            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Tennis Ball Machine</h3>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Enable Pitch Type Selection</p>
                  <p className="text-xs text-gray-400">Users choose between Astro and Turf pitch types</p>
                </div>
                <button
                  onClick={() => setMachineConfig(prev => ({
                    ...prev,
                    tennisMachine: { ...prev.tennisMachine, pitchTypeSelectionEnabled: !prev.tennisMachine.pitchTypeSelectionEnabled },
                  }))}
                  className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${
                    machineConfig.tennisMachine.pitchTypeSelectionEnabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    machineConfig.tennisMachine.pitchTypeSelectionEnabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {machineConfig.tennisMachine.pitchTypeSelectionEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">Astro Pitch Price</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input
                        type="number"
                        value={machineConfig.tennisMachine.astroPitchPrice}
                        onChange={e => setMachineConfig(prev => ({
                          ...prev,
                          tennisMachine: { ...prev.tennisMachine, astroPitchPrice: Number(e.target.value) },
                        }))}
                        min="0"
                        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-400 mb-1">Turf Pitch Price</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                      <input
                        type="number"
                        value={machineConfig.tennisMachine.turfPitchPrice}
                        onChange={e => setMachineConfig(prev => ({
                          ...prev,
                          tennisMachine: { ...prev.tennisMachine, turfPitchPrice: Number(e.target.value) },
                        }))}
                        min="0"
                        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Operator Configuration */}
            <div className="pt-4 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Operator Configuration</h3>
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-700">Number of Operators</p>
                <p className="text-xs text-gray-400 mb-2">How many parallel operator-assisted bookings are allowed per time slot</p>
                <input
                  type="number"
                  value={machineConfig.numberOfOperators}
                  onChange={e => setMachineConfig(prev => ({
                    ...prev,
                    numberOfOperators: Math.max(1, Math.floor(Number(e.target.value))),
                  }))}
                  min="1"
                  className="w-32 border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <p className="text-xs text-blue-700">
                  With {machineConfig.numberOfOperators} operator{machineConfig.numberOfOperators > 1 ? 's' : ''},
                  up to {machineConfig.numberOfOperators} machine{machineConfig.numberOfOperators > 1 ? 's' : ''} can
                  be operated simultaneously per time slot. Leather machine always requires an operator.
                  Tennis machine can be self-operated when no operator is available.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-3">
              <button
                onClick={handleSaveMachine}
                disabled={savingMachine}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-light text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingMachine ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Machine Config
              </button>
              {machineMessage.text && (
                <span className={`text-sm ${machineMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                  {machineMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Discount Configuration */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Percent className="w-5 h-5 text-primary" />
          <h2 className="text-sm font-semibold text-gray-900">Consecutive Slot Discount</h2>
        </div>

        {discountLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading configuration...</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Enable Consecutive Discount</p>
                <p className="text-xs text-gray-400">Apply discount when users book consecutive slots</p>
              </div>
              <button
                onClick={() => setDiscountConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${
                  discountConfig.enabled ? 'bg-primary' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  discountConfig.enabled ? 'left-6' : 'left-1'
                }`} />
              </button>
            </div>

            {discountConfig.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-gray-100">
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Default Slot Price</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="number" value={discountConfig.defaultSlotPrice} onChange={e => setDiscountConfig(prev => ({ ...prev, defaultSlotPrice: Number(e.target.value) }))} min="0" className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Min Consecutive Slots</label>
                  <input type="number" value={discountConfig.minSlots} onChange={e => setDiscountConfig(prev => ({ ...prev, minSlots: Number(e.target.value) }))} min="2" className={inputClass} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Discount Type</label>
                  <select value={discountConfig.discountType} onChange={e => setDiscountConfig(prev => ({ ...prev, discountType: e.target.value }))} className={`${inputClass} cursor-pointer`}>
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (₹)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Discount Value {discountConfig.discountType === 'PERCENTAGE' ? '(%)' : '(₹)'}</label>
                  <input type="number" value={discountConfig.discountValue} onChange={e => setDiscountConfig(prev => ({ ...prev, discountValue: Number(e.target.value) }))} min="0" max={discountConfig.discountType === 'PERCENTAGE' ? 100 : undefined} className={inputClass} />
                </div>
              </div>
            )}

            {!discountConfig.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-gray-100">
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Default Slot Price</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                    <input type="number" value={discountConfig.defaultSlotPrice} onChange={e => setDiscountConfig(prev => ({ ...prev, defaultSlotPrice: Number(e.target.value) }))} min="0" className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-3">
              <button onClick={handleSaveDiscount} disabled={savingDiscount} className="inline-flex items-center gap-2 bg-primary hover:bg-primary-light text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
                {savingDiscount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Discount Config
              </button>
              {discountMessage.text && (
                <span className={`text-sm ${discountMessage.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                  {discountMessage.text}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
