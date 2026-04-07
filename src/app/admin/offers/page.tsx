'use client';

import { useState, useEffect } from 'react';
import { Gift, Plus, Pencil, ToggleLeft, ToggleRight, Loader2, Trash2, Save, Edit2 } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

interface OfferData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timeSlotStart: string | null;
  timeSlotEnd: string | null;
  days: number[];
  machineId: string | null;
  pitchType: string | null;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RecurringDiscountRule {
  id: string;
  enabled: boolean;
  days: number[];
  slotStartTime: string;
  slotEndTime: string;
  machineId: string | null;
  oneSlotDiscount: number;
  twoSlotDiscount: number;
}

const MACHINE_OPTIONS = [
  { id: 'GRAVITY', label: 'Gravity (Leather)' },
  { id: 'YANTRA', label: 'Yantra (Premium Leather)' },
  { id: 'LEVERAGE_INDOOR', label: 'Leverage Tennis (Indoor)' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage Tennis (Outdoor)' },
];

const PITCH_TYPES = [
  { id: 'ASTRO', label: 'Astro Turf' },
  { id: 'CEMENT', label: 'Cement' },
  { id: 'NATURAL', label: 'Natural Turf' },
];

const DAYS_OF_WEEK = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

const DAY_LABELS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
const DAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];
const ALL_MACHINE_IDS = ['GRAVITY', 'YANTRA', 'LEVERAGE_INDOOR', 'LEVERAGE_OUTDOOR'];
const MACHINE_LABELS: Record<string, { name: string }> = {
  GRAVITY: { name: 'Gravity (Leather)' },
  YANTRA: { name: 'Yantra (Premium Leather)' },
  LEVERAGE_INDOOR: { name: 'Leverage Indoor' },
  LEVERAGE_OUTDOOR: { name: 'Leverage Outdoor' },
};

const inputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

const emptyForm = {
  name: '',
  startDate: new Date().toISOString().split('T')[0],
  endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  timeSlotStart: null as string | null,
  timeSlotEnd: null as string | null,
  days: [] as number[],
  machineId: null as string | null,
  pitchType: null as string | null,
  discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
  discountValue: 10,
};

export default function AdminOffers() {
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Recurring Slot Discounts
  const [recurringRules, setRecurringRules] = useState<RecurringDiscountRule[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringDiscountRule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    days: [] as number[],
    slotStartTime: '08:00',
    slotEndTime: '08:30',
    machineId: '',
    oneSlotDiscount: 0,
    twoSlotDiscount: 0,
    enabled: true,
  });
  const [savingRule, setSavingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState({ text: '', type: '' });

  const fetchOffers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/offers');
      if (res.ok) {
        const data = await res.json();
        setOffers(data);
      }
    } catch (e) {
      console.error('Failed to fetch offers', e);
      setMessage({ text: 'Failed to load offers', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();
    fetchRecurringRules();
  }, []);

  const fetchRecurringRules = async () => {
    try {
      const res = await fetch('/api/admin/recurring-discounts');
      if (res.ok) {
        const data = await res.json();
        setRecurringRules(data.rules || []);
      }
    } catch (error) {
      console.error('Failed to fetch recurring rules:', error);
    } finally {
      setRecurringLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    // Validation
    if (!form.name.trim()) {
      setMessage({ text: 'Offer name is required', type: 'error' });
      return;
    }
    if (!form.startDate || !form.endDate) {
      setMessage({ text: 'Start and end dates are required', type: 'error' });
      return;
    }
    if (new Date(form.startDate) > new Date(form.endDate)) {
      setMessage({ text: 'Start date must be before end date', type: 'error' });
      return;
    }
    if (form.discountValue <= 0) {
      setMessage({ text: 'Discount value must be positive', type: 'error' });
      return;
    }
    if (form.discountType === 'PERCENTAGE' && form.discountValue > 100) {
      setMessage({ text: 'Percentage discount cannot exceed 100', type: 'error' });
      return;
    }
    if (form.timeSlotStart && form.timeSlotEnd) {
      if (form.timeSlotStart >= form.timeSlotEnd) {
        setMessage({ text: 'Time slot start must be before end', type: 'error' });
        return;
      }
    }

    setSubmitting(true);
    try {
      const url = editingId ? '/api/admin/offers' : '/api/admin/offers';
      const method = editingId ? 'PATCH' : 'POST';
      const body = editingId ? { id: editingId, ...form } : form;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage({
          text: editingId ? 'Offer updated successfully' : 'Offer created successfully',
          type: 'success',
        });
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        fetchOffers();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to save offer', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (offer: OfferData) => {
    setForm({
      name: offer.name,
      startDate: offer.startDate,
      endDate: offer.endDate,
      timeSlotStart: offer.timeSlotStart,
      timeSlotEnd: offer.timeSlotEnd,
      days: offer.days,
      machineId: offer.machineId,
      pitchType: offer.pitchType,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
    });
    setEditingId(offer.id);
    setShowForm(true);
    setMessage({ text: '', type: '' });
  };

  const toggleActive = async (offer: OfferData) => {
    try {
      const res = await fetch('/api/admin/offers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: offer.id, isActive: !offer.isActive }),
      });

      if (res.ok) {
        setMessage({
          text: offer.isActive ? 'Offer deactivated' : 'Offer activated',
          type: 'success',
        });
        fetchOffers();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to toggle offer', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const deleteOffer = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/offers?id=${id}`, { method: 'DELETE' });

      if (res.ok) {
        setMessage({ text: 'Offer deleted successfully', type: 'success' });
        setDeleteConfirm(null);
        fetchOffers();
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed to delete offer', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  // ─── Recurring Discount Helpers ─────────────────
  const resetRuleForm = () => {
    setRuleForm({ days: [], slotStartTime: '08:00', slotEndTime: '08:30', machineId: '', oneSlotDiscount: 0, twoSlotDiscount: 0, enabled: true });
    setEditingRule(null);
    setShowAddRule(false);
  };

  const handleSaveRule = async () => {
    // Validate end time is after start time
    if (ruleForm.slotEndTime <= ruleForm.slotStartTime) {
      setRuleMessage({ text: 'End time must be after start time', type: 'error' });
      return;
    }
    if (ruleForm.days.length === 0) {
      setRuleMessage({ text: 'Select at least one day', type: 'error' });
      return;
    }
    setSavingRule(true);
    try {
      const payload = {
        days: ruleForm.days,
        slotStartTime: ruleForm.slotStartTime,
        slotEndTime: ruleForm.slotEndTime,
        machineId: ruleForm.machineId || null,
        oneSlotDiscount: Number(ruleForm.oneSlotDiscount),
        twoSlotDiscount: Number(ruleForm.twoSlotDiscount),
        enabled: ruleForm.enabled,
      };
      let res;
      if (editingRule) {
        res = await fetch(`/api/admin/recurring-discounts/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/recurring-discounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        resetRuleForm();
        fetchRecurringRules();
        setRuleMessage({ text: editingRule ? 'Rule updated' : 'Rule created', type: 'success' });
      } else {
        const data = await res.json();
        setRuleMessage({ text: data.error || 'Failed to save rule', type: 'error' });
      }
    } catch {
      setRuleMessage({ text: 'Failed to save rule', type: 'error' });
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/recurring-discounts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRecurringRules();
        setRuleMessage({ text: 'Rule deleted', type: 'success' });
      }
    } catch {
      setRuleMessage({ text: 'Failed to delete rule', type: 'error' });
    }
  };

  const handleToggleRule = async (rule: RecurringDiscountRule) => {
    try {
      await fetch(`/api/admin/recurring-discounts/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      fetchRecurringRules();
    } catch {
      setRuleMessage({ text: 'Failed to toggle rule', type: 'error' });
    }
  };

  const startEditRule = (rule: RecurringDiscountRule) => {
    setRuleForm({
      days: rule.days,
      slotStartTime: rule.slotStartTime,
      slotEndTime: rule.slotEndTime,
      machineId: rule.machineId || '',
      oneSlotDiscount: rule.oneSlotDiscount,
      twoSlotDiscount: rule.twoSlotDiscount,
      enabled: rule.enabled,
    });
    setEditingRule(rule);
    setShowAddRule(true);
  };

  const renderRuleForm = () => (
    <div className="bg-white/[0.03] rounded-xl border border-accent/20 p-4 space-y-3 mt-2">
      <h4 className="text-xs font-bold text-accent">{editingRule ? 'Edit Rule' : 'New Rule'}</h4>
      <div>
        <label className="block text-[10px] font-medium text-slate-400 mb-1">Days of Week</label>
        <div className="flex flex-wrap gap-1">
          {DAY_NUMBERS.map(d => (
            <button
              key={d}
              onClick={() => {
                setRuleForm(prev => ({
                  ...prev,
                  days: prev.days.includes(d) ? prev.days.filter(x => x !== d) : [...prev.days, d],
                }));
              }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                ruleForm.days.includes(d)
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-white/[0.04] text-slate-500 border border-white/[0.08] hover:bg-white/[0.08]'
              }`}
            >{DAY_LABELS[d]}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">Start Time</label>
          <input type="time" value={ruleForm.slotStartTime} onChange={e => setRuleForm(prev => ({ ...prev, slotStartTime: e.target.value }))} step="1800" className={inputClass} />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">End Time</label>
          <input type="time" value={ruleForm.slotEndTime} onChange={e => setRuleForm(prev => ({ ...prev, slotEndTime: e.target.value }))} step="1800" className={inputClass} />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-medium text-slate-400 mb-1">Machine (optional)</label>
        <select
          value={ruleForm.machineId}
          onChange={e => setRuleForm(prev => ({ ...prev, machineId: e.target.value }))}
          className={inputClass}
        >
          <option value="">All Machines</option>
          {ALL_MACHINE_IDS.map(mid => (
            <option key={mid} value={mid}>{MACHINE_LABELS[mid].name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">Discount for 1 Slot (₹)</label>
          <input
            type="number"
            value={ruleForm.oneSlotDiscount}
            onChange={e => setRuleForm(prev => ({ ...prev, oneSlotDiscount: Number(e.target.value) || 0 }))}
            placeholder="0"
            min="0"
            step="10"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">Discount for 2 Cons. Slots (₹)</label>
          <input
            type="number"
            value={ruleForm.twoSlotDiscount}
            onChange={e => setRuleForm(prev => ({ ...prev, twoSlotDiscount: Number(e.target.value) || 0 }))}
            placeholder="0"
            min="0"
            step="10"
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSaveRule}
          disabled={savingRule || ruleForm.days.length === 0}
          className="inline-flex items-center gap-1.5 bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          {savingRule ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {editingRule ? 'Update' : 'Save Rule'}
        </button>
        <button
          onClick={resetRuleForm}
          className="text-xs text-slate-500 hover:text-slate-300 px-3 py-1.5 cursor-pointer"
        >Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <AdminPageHeader icon={Gift} title="Offers & Discounts" description="Manage promotional offers and recurring discounts">
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm(emptyForm);
            setMessage({ text: '', type: '' });
          }}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {showForm ? 'Cancel' : 'Create Offer'}
        </button>
      </AdminPageHeader>

      {/* Recurring Slot Discounts Section */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Recurring Slot Discounts</h2>
            <p className="text-[11px] text-slate-400 mt-1">Fixed discounts for specific day + time combinations</p>
          </div>
        </div>

        {ruleMessage.text && (
          <p className={`mb-4 text-sm ${ruleMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {ruleMessage.text}
          </p>
        )}

        {recurringLoading ? (
          <div className="flex items-center gap-2 py-4 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading discount rules...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Existing Rules */}
            {recurringRules.length === 0 && !showAddRule && (
              <p className="text-xs text-slate-500 italic">No recurring discount rules configured.</p>
            )}
            {recurringRules.map(rule => (
              <div key={rule.id}>
                <div className={`bg-white/[0.02] rounded-xl border p-3 ${rule.enabled ? 'border-emerald-500/20' : 'border-white/[0.05] opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1 mb-1">
                        {rule.days.map(d => (
                          <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent">{DAY_LABELS[d]}</span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-300">
                        {rule.slotStartTime} – {rule.slotEndTime}
                        {rule.machineId && <span className="text-slate-500 ml-2">({MACHINE_LABELS[rule.machineId]?.name || rule.machineId})</span>}
                      </p>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] text-emerald-400">1 slot: -₹{rule.oneSlotDiscount}</span>
                        <span className="text-[10px] text-emerald-400">2 slots: -₹{rule.twoSlotDiscount}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleToggleRule(rule)}
                        className={`p-1.5 rounded-lg text-[10px] font-medium cursor-pointer ${rule.enabled ? 'text-emerald-400 bg-emerald-400/10' : 'text-slate-500 bg-white/[0.04]'}`}
                      >{rule.enabled ? 'ON' : 'OFF'}</button>
                      <button onClick={() => startEditRule(rule)} className="p-1.5 rounded-lg text-slate-400 hover:text-accent hover:bg-accent/10 cursor-pointer"><Edit2 className="w-3 h-3" /></button>
                      <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
                {/* Inline edit form — appears right below the rule being edited */}
                {showAddRule && editingRule?.id === rule.id && renderRuleForm()}
              </div>
            ))}

            {/* New rule form — appears at bottom only for new rules (not editing) */}
            {showAddRule && !editingRule ? renderRuleForm() : null}
            {!showAddRule && (
              <button
                onClick={() => setShowAddRule(true)}
                className="inline-flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Discount Rule
              </button>
            )}
          </div>
        )}
      </div>

      {/* Promotional Offers Section */}
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-white mb-2">Promotional Offers</h2>
        <p className="text-[11px] text-slate-400 mb-4">Date-based discounts for specific machines, pitches & time slots</p>
      </div>

      {message.text && (
        <p className={`mb-4 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-5 mb-5">
          <h2 className="text-sm font-semibold text-white mb-4">
            {editingId ? 'Edit Offer' : 'New Offer'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Offer Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Monsoon Discount"
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-slate-500"
              />
            </div>

            {/* Discount Type & Value */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Discount Type *
                </label>
                <select
                  value={form.discountType}
                  onChange={e => setForm({ ...form, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                >
                  <option value="PERCENTAGE" className="bg-[#1a2a40]">
                    Percentage (%)
                  </option>
                  <option value="FIXED" className="bg-[#1a2a40]">
                    Fixed Amount (₹)
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Discount Value *
                </label>
                <input
                  type="number"
                  value={form.discountValue}
                  onChange={e => setForm({ ...form, discountValue: parseFloat(e.target.value) || 0 })}
                  placeholder="10"
                  step="0.01"
                  min="0"
                  max={form.discountType === 'PERCENTAGE' ? 100 : undefined}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Time Slot */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Time Slot Start (HH:MM) - Optional
                </label>
                <input
                  type="time"
                  value={form.timeSlotStart || ''}
                  onChange={e => setForm({ ...form, timeSlotStart: e.target.value || null })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Time Slot End (HH:MM) - Optional
                </label>
                <input
                  type="time"
                  value={form.timeSlotEnd || ''}
                  onChange={e => setForm({ ...form, timeSlotEnd: e.target.value || null })}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Machine ID */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Machine - Optional (null = all machines)
              </label>
              <select
                value={form.machineId || ''}
                onChange={e => setForm({ ...form, machineId: e.target.value || null })}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
              >
                <option value="" className="bg-[#1a2a40]">
                  All Machines
                </option>
                {MACHINE_OPTIONS.map(m => (
                  <option key={m.id} value={m.id} className="bg-[#1a2a40]">
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Pitch Type */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Pitch Type - Optional (null = all pitches)
              </label>
              <select
                value={form.pitchType || ''}
                onChange={e => setForm({ ...form, pitchType: e.target.value || null })}
                className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent"
              >
                <option value="" className="bg-[#1a2a40]">
                  All Pitch Types
                </option>
                {PITCH_TYPES.map(p => (
                  <option key={p.id} value={p.id} className="bg-[#1a2a40]">
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Days of Week */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-2">
                Days of Week - Optional (empty = all days)
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => {
                      const newDays = form.days.includes(day.id)
                        ? form.days.filter(d => d !== day.id)
                        : [...form.days, day.id].sort((a, b) => a - b);
                      setForm({ ...form, days: newDays });
                    }}
                    className={`px-3 py-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${
                      form.days.includes(day.id)
                        ? 'bg-accent/20 border-accent/40 text-accent'
                        : 'bg-white/[0.04] border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : editingId ? (
                'Update Offer'
              ) : (
                'Create Offer'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Offers List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading offers...</span>
        </div>
      ) : offers.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Gift className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">No promotional offers created yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {offers.map(offer => (
            <div
              key={offer.id}
              className={`bg-white/[0.03] backdrop-blur-sm rounded-xl border ${
                editingId === offer.id ? 'border-accent/30' : 'border-white/[0.08]'
              } p-4`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-white">{offer.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        offer.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {offer.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Details Grid */}
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-400 mb-2">
                    <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                      {new Date(offer.startDate).toLocaleDateString('en-IN')} -{' '}
                      {new Date(offer.endDate).toLocaleDateString('en-IN')}
                    </span>
                    {offer.timeSlotStart && offer.timeSlotEnd && (
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                        {offer.timeSlotStart} – {offer.timeSlotEnd}
                      </span>
                    )}
                    <span className="bg-accent/15 px-2 py-0.5 rounded text-accent font-medium">
                      {offer.discountType === 'PERCENTAGE'
                        ? `${offer.discountValue}% off`
                        : `₹${offer.discountValue} off`}
                    </span>
                    {offer.machineId && (
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                        {MACHINE_OPTIONS.find(m => m.id === offer.machineId)?.label || offer.machineId}
                      </span>
                    )}
                    {offer.pitchType && (
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                        {PITCH_TYPES.find(p => p.id === offer.pitchType)?.label || offer.pitchType}
                      </span>
                    )}
                    {offer.days && offer.days.length > 0 && (
                      <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                        {offer.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(', ')}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-500">
                    Created {new Date(offer.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={() => startEdit(offer)}
                    className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleActive(offer)}
                    className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                    title={offer.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {offer.isActive ? (
                      <ToggleRight className="w-5 h-5 text-green-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-slate-500" />
                    )}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(offer.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Delete Confirmation */}
              {deleteConfirm === offer.id && (
                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-red-200">
                    Are you sure you want to delete this offer?
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteOffer(offer.id)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
