'use client';

import { useState, useEffect, useRef } from 'react';
import { Gift, Plus, Pencil, Loader2, Trash2, Repeat, Tag } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

interface OfferData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timeSlotStart: string | null;
  timeSlotEnd: string | null;
  days: number[];
  machineIds: string[];
  pitchTypes: string[];
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  isActive: boolean;
  appliesTo: 'ALL' | 'SPECIAL';
  createdAt: string;
  updatedAt: string;
}

interface RecurringDiscountRule {
  id: string;
  enabled: boolean;
  days: number[];
  slotStartTime: string;
  slotEndTime: string;
  machineIds: string[];
  pitchTypes: string[];
  oneSlotDiscount: number;
  twoSlotDiscount: number;
  appliesTo: 'ALL' | 'SPECIAL';
}

const MACHINE_OPTIONS = [
  { id: 'GRAVITY', label: 'Gravity' },
  { id: 'YANTRA', label: 'Yantra' },
  { id: 'LEVERAGE_INDOOR', label: 'Indoor' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Outdoor' },
];

const PITCH_TYPES = [
  { id: 'ASTRO', label: 'Astro' },
  { id: 'CEMENT', label: 'Cement' },
  { id: 'NATURAL', label: 'Natural' },
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

const inputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

const chipClass = (active: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
    active
      ? 'bg-accent/20 text-accent border border-accent/40'
      : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-white/20'
  }`;

const emptyPromoForm = {
  name: '',
  startDate: new Date().toISOString().split('T')[0],
  endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  timeSlotStart: null as string | null,
  timeSlotEnd: null as string | null,
  days: [] as number[],
  machineIds: [] as string[],
  pitchTypes: [] as string[],
  discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
  discountValue: 10,
  appliesTo: 'ALL' as 'ALL' | 'SPECIAL',
};

const emptyRecurringForm = {
  days: [] as number[],
  slotStartTime: '08:00',
  slotEndTime: '08:30',
  machineIds: [] as string[],
  pitchTypes: [] as string[],
  oneSlotDiscount: '' as string,
  twoSlotDiscount: '' as string,
  enabled: true,
  appliesTo: 'ALL' as 'ALL' | 'SPECIAL',
};

// ─── Chip Multi-Select Component ───────────────────────────────────
function ChipSelect({ label, hint, options, selected, onChange }: {
  label: string; hint?: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
        {label} {hint && <span className="text-slate-600">{hint}</span>}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o.id} type="button"
            onClick={() => onChange(
              selected.includes(o.id) ? selected.filter(x => x !== o.id) : [...selected, o.id]
            )}
            className={chipClass(selected.includes(o.id))}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function DayChipSelect({ selected, onChange }: { selected: number[]; onChange: (v: number[]) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Days</label>
      <div className="flex flex-wrap gap-1.5">
        {DAYS_OF_WEEK.map(d => (
          <button key={d.id} type="button"
            onClick={() => onChange(
              selected.includes(d.id)
                ? selected.filter(x => x !== d.id)
                : [...selected, d.id].sort((a, b) => a - b)
            )}
            className={chipClass(selected.includes(d.id))}
          >{d.label}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────
export default function AdminOffers() {
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringDiscountRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [submitting, setSubmitting] = useState(false);

  // Edit state — tracks which offer is being edited and which type
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'PROMOTIONAL' | 'RECURRING' | null>(null);

  // Create new
  const [createType, setCreateType] = useState<'PROMOTIONAL' | 'RECURRING' | null>(null);

  // Forms
  const [promoForm, setPromoForm] = useState(emptyPromoForm);
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm);

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; type: 'PROMOTIONAL' | 'RECURRING' } | null>(null);

  // Refs for scrolling
  const editFormRef = useRef<HTMLDivElement>(null);
  const createFormRef = useRef<HTMLDivElement>(null);
  const recurringSectionRef = useRef<HTMLElement>(null);
  const promoSectionRef = useRef<HTMLElement>(null);

  const fetchOffers = async () => {
    try {
      const res = await fetch('/api/admin/offers');
      if (res.ok) setOffers(await res.json());
    } catch (e) {
      console.error('Failed to fetch offers', e);
    }
  };

  const fetchRecurringRules = async () => {
    try {
      const res = await fetch('/api/admin/recurring-discounts');
      if (res.ok) {
        const data = await res.json();
        setRecurringRules(data.rules || []);
      }
    } catch (e) {
      console.error('Failed to fetch recurring rules', e);
    }
  };

  useEffect(() => {
    Promise.all([fetchOffers(), fetchRecurringRules()]).finally(() => setLoading(false));
  }, []);

  const resetAll = () => {
    setEditingId(null);
    setEditingType(null);
    setCreateType(null);
    setPromoForm(emptyPromoForm);
    setRecurringForm(emptyRecurringForm);
    setMessage({ text: '', type: '' });
  };

  // ─── Promotional Handlers ──────────────────────────
  const handlePromoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    if (!promoForm.name.trim()) return setMessage({ text: 'Name required', type: 'error' });
    if (new Date(promoForm.startDate) > new Date(promoForm.endDate)) return setMessage({ text: 'Start must be before end', type: 'error' });
    if (promoForm.discountValue <= 0) return setMessage({ text: 'Discount must be positive', type: 'error' });
    if (promoForm.discountType === 'PERCENTAGE' && promoForm.discountValue > 100) return setMessage({ text: 'Max 100%', type: 'error' });

    setSubmitting(true);
    try {
      const isEdit = editingId && editingType === 'PROMOTIONAL';
      const res = await fetch('/api/admin/offers', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...promoForm } : promoForm),
      });
      if (res.ok) {
        setMessage({ text: isEdit ? 'Updated' : 'Created', type: 'success' });
        resetAll();
        await fetchOffers();
        setTimeout(() => promoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Error', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditPromo = (offer: OfferData) => {
    resetAll();
    setPromoForm({
      name: offer.name,
      startDate: offer.startDate ? new Date(offer.startDate).toISOString().split('T')[0] : '',
      endDate: offer.endDate ? new Date(offer.endDate).toISOString().split('T')[0] : '',
      timeSlotStart: offer.timeSlotStart,
      timeSlotEnd: offer.timeSlotEnd,
      days: offer.days,
      machineIds: offer.machineIds || [],
      pitchTypes: offer.pitchTypes || [],
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      appliesTo: offer.appliesTo || 'ALL',
    });
    setEditingId(offer.id);
    setEditingType('PROMOTIONAL');
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  };

  const toggleActivePromo = async (offer: OfferData) => {
    try {
      const res = await fetch('/api/admin/offers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: offer.id, isActive: !offer.isActive }),
      });
      if (res.ok) fetchOffers();
    } catch { /* ignore */ }
  };

  const deletePromo = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/offers?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        fetchOffers();
      }
    } catch { /* ignore */ }
  };

  // ─── Recurring Handlers ────────────────────────────
  const handleRecurringSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    if (recurringForm.days.length === 0) return setMessage({ text: 'Select days', type: 'error' });
    if (recurringForm.slotEndTime <= recurringForm.slotStartTime) return setMessage({ text: 'End after start', type: 'error' });

    setSubmitting(true);
    try {
      const payload = {
        days: recurringForm.days,
        slotStartTime: recurringForm.slotStartTime,
        slotEndTime: recurringForm.slotEndTime,
        machineIds: recurringForm.machineIds,
        pitchTypes: recurringForm.pitchTypes,
        oneSlotDiscount: Number(recurringForm.oneSlotDiscount) || 0,
        twoSlotDiscount: Number(recurringForm.twoSlotDiscount) || 0,
        enabled: recurringForm.enabled,
        appliesTo: recurringForm.appliesTo,
      };

      const isEdit = editingId && editingType === 'RECURRING';
      const res = isEdit
        ? await fetch(`/api/admin/recurring-discounts/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/recurring-discounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (res.ok) {
        setMessage({ text: isEdit ? 'Updated' : 'Created', type: 'success' });
        resetAll();
        await fetchRecurringRules();
        setTimeout(() => recurringSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else {
        const data = await res.json();
        setMessage({ text: data.error || 'Failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Error', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditRule = (rule: RecurringDiscountRule) => {
    resetAll();
    setRecurringForm({
      days: rule.days,
      slotStartTime: rule.slotStartTime,
      slotEndTime: rule.slotEndTime,
      machineIds: rule.machineIds || [],
      pitchTypes: rule.pitchTypes || [],
      oneSlotDiscount: String(rule.oneSlotDiscount || ''),
      twoSlotDiscount: String(rule.twoSlotDiscount || ''),
      enabled: rule.enabled,
      appliesTo: rule.appliesTo,
    });
    setEditingId(rule.id);
    setEditingType('RECURRING');
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  };

  const toggleRecurring = async (rule: RecurringDiscountRule) => {
    try {
      await fetch(`/api/admin/recurring-discounts/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      fetchRecurringRules();
    } catch { /* ignore */ }
  };

  const deleteRecurring = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/recurring-discounts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteConfirm(null);
        fetchRecurringRules();
      }
    } catch { /* ignore */ }
  };

  // ─── Shared Form UI ───────────────────────────────
  const PromoFormUI = ({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) => (
    <form onSubmit={onSubmit} className="space-y-3">
      {message.text && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>
      )}
      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">Name *</label>
        <input type="text" value={promoForm.name} onChange={e => setPromoForm({ ...promoForm, name: e.target.value })}
          placeholder="e.g. Monsoon Discount" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Type</label>
          <select value={promoForm.discountType}
            onChange={e => setPromoForm({ ...promoForm, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })}
            className={inputClass}>
            <option value="PERCENTAGE" className="bg-[#1a2a40]">Percentage (%)</option>
            <option value="FIXED" className="bg-[#1a2a40]">Fixed (₹)</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Value *</label>
          <input type="text" inputMode="numeric" value={promoForm.discountValue || ''}
            placeholder="0"
            onChange={e => setPromoForm({ ...promoForm, discountValue: parseFloat(e.target.value) || 0 })}
            className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Date *</label>
          <input type="date" value={promoForm.startDate}
            onChange={e => setPromoForm({ ...promoForm, startDate: e.target.value })}
            className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">End Date *</label>
          <input type="date" value={promoForm.endDate}
            onChange={e => setPromoForm({ ...promoForm, endDate: e.target.value })}
            className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Start</label>
          <input type="time" value={promoForm.timeSlotStart || ''}
            onChange={e => setPromoForm({ ...promoForm, timeSlotStart: e.target.value || null })}
            className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Time End</label>
          <input type="time" value={promoForm.timeSlotEnd || ''}
            onChange={e => setPromoForm({ ...promoForm, timeSlotEnd: e.target.value || null })}
            className={inputClass} />
        </div>
      </div>
      <ChipSelect label="Machines" hint="(empty = all)" options={MACHINE_OPTIONS} selected={promoForm.machineIds}
        onChange={v => setPromoForm({ ...promoForm, machineIds: v })} />
      <ChipSelect label="Pitch Types" hint="(empty = all)" options={PITCH_TYPES} selected={promoForm.pitchTypes}
        onChange={v => setPromoForm({ ...promoForm, pitchTypes: v })} />
      <DayChipSelect selected={promoForm.days} onChange={v => setPromoForm({ ...promoForm, days: v })} />
      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">Applies To</label>
        <select value={promoForm.appliesTo}
          onChange={e => setPromoForm({ ...promoForm, appliesTo: e.target.value as 'ALL' | 'SPECIAL' })}
          className={inputClass}>
          <option value="ALL" className="bg-[#1a2a40]">All Users</option>
          <option value="SPECIAL" className="bg-[#1a2a40]">Special Users Only</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={submitting}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {editingId ? 'Update' : 'Create'}
        </button>
        <button type="button" onClick={resetAll}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  );

  const RecurringFormUI = ({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) => (
    <form onSubmit={onSubmit} className="space-y-3">
      {message.text && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>
      )}
      <DayChipSelect selected={recurringForm.days} onChange={v => setRecurringForm({ ...recurringForm, days: v })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Time *</label>
          <input type="time" value={recurringForm.slotStartTime} step="1800"
            onChange={e => setRecurringForm({ ...recurringForm, slotStartTime: e.target.value })}
            className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">End Time *</label>
          <input type="time" value={recurringForm.slotEndTime} step="1800"
            onChange={e => setRecurringForm({ ...recurringForm, slotEndTime: e.target.value })}
            className={inputClass} />
        </div>
      </div>
      <ChipSelect label="Machines" hint="(empty = all)" options={MACHINE_OPTIONS} selected={recurringForm.machineIds}
        onChange={v => setRecurringForm({ ...recurringForm, machineIds: v })} />
      <ChipSelect label="Pitch Types" hint="(empty = all)" options={PITCH_TYPES} selected={recurringForm.pitchTypes}
        onChange={v => setRecurringForm({ ...recurringForm, pitchTypes: v })} />
      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">Applies To</label>
        <select value={recurringForm.appliesTo}
          onChange={e => setRecurringForm({ ...recurringForm, appliesTo: e.target.value as 'ALL' | 'SPECIAL' })}
          className={inputClass}>
          <option value="ALL" className="bg-[#1a2a40]">All Users</option>
          <option value="SPECIAL" className="bg-[#1a2a40]">Special Users Only</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">1 Slot Discount (₹)</label>
          <input type="text" inputMode="numeric" value={recurringForm.oneSlotDiscount}
            placeholder="0"
            onChange={e => setRecurringForm({ ...recurringForm, oneSlotDiscount: e.target.value.replace(/[^0-9.]/g, '') })}
            className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">2 Slot Discount (₹)</label>
          <input type="text" inputMode="numeric" value={recurringForm.twoSlotDiscount}
            placeholder="0"
            onChange={e => setRecurringForm({ ...recurringForm, twoSlotDiscount: e.target.value.replace(/[^0-9.]/g, '') })}
            className={inputClass} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={submitting || recurringForm.days.length === 0}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {editingId ? 'Update' : 'Create'}
        </button>
        <button type="button" onClick={resetAll}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  );

  // ─── Render ───────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <AdminPageHeader icon={Gift} title="Offers & Discounts" description="Manage promotional and recurring offers" />
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <AdminPageHeader icon={Gift} title="Offers & Discounts" description="Manage promotional and recurring offers" />

      {/* ═══ RECURRING OFFERS SECTION ═══ */}
      <section ref={recurringSectionRef} className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-white">Recurring Offers</h2>
            <span className="text-xs text-slate-500">({recurringRules.length})</span>
          </div>
          <button onClick={() => { resetAll(); setCreateType('RECURRING'); setTimeout(() => createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100); }}
            className="inline-flex items-center gap-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* Create form at top of section */}
        {createType === 'RECURRING' && (
          <div ref={createFormRef} className="bg-white/[0.03] border border-blue-500/20 rounded-xl p-4 mb-3">
            <h3 className="text-sm font-medium text-white mb-3">New Recurring Offer</h3>
            {RecurringFormUI({ onSubmit: handleRecurringSubmit })}
          </div>
        )}

        {recurringRules.length === 0 && !createType ? (
          <div className="text-center py-8 text-slate-500 text-sm">No recurring offers yet</div>
        ) : (
          <div className="space-y-2">
            {recurringRules.map(rule => (
              <div key={rule.id}>
                {/* Card */}
                <div className={`bg-white/[0.03] rounded-xl border ${editingId === rule.id ? 'border-blue-500/30' : 'border-white/[0.07]'} p-3 transition-all`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-sm font-medium text-white">
                          {rule.slotStartTime} – {rule.slotEndTime}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rule.enabled ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {rule.enabled ? 'Active' : 'Off'}
                        </span>
                        {rule.appliesTo === 'SPECIAL' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-400">Special Users</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-400">All Users</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {rule.days?.length > 0 && (
                          <span className="text-sky-400">{rule.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(', ')}</span>
                        )}
                        <span className="text-emerald-400 font-medium">-₹{rule.oneSlotDiscount} / -₹{rule.twoSlotDiscount}</span>
                        {rule.machineIds?.length > 0 && (
                          <span>{rule.machineIds.map(m => MACHINE_OPTIONS.find(o => o.id === m)?.label).join(', ')}</span>
                        )}
                        {rule.pitchTypes?.length > 0 && (
                          <span>{rule.pitchTypes.map(p => PITCH_TYPES.find(o => o.id === p)?.label).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => startEditRule(rule)} title="Edit"
                        className="p-1.5 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleRecurring(rule)} title={rule.enabled ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer text-xs ${rule.enabled ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-slate-500 hover:bg-white/[0.08]'}`}>
                        {rule.enabled ? '✓' : '○'}
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: rule.id, type: 'RECURRING' })} title="Delete"
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Delete confirm */}
                  {deleteConfirm?.id === rule.id && (
                    <div className="mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
                      <span className="text-xs text-red-200">Delete this rule?</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => setDeleteConfirm(null)} className="px-2.5 py-1 rounded text-xs text-slate-400 hover:text-white cursor-pointer">Cancel</button>
                        <button onClick={() => deleteRecurring(rule.id)} className="px-2.5 py-1 rounded text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer">Delete</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edit form directly below card */}
                {editingId === rule.id && editingType === 'RECURRING' && (
                  <div ref={editFormRef} className="bg-white/[0.03] border border-blue-500/20 border-t-0 rounded-b-xl p-4 -mt-1">
                    <h3 className="text-sm font-medium text-white mb-3">Edit Recurring Offer</h3>
                    {RecurringFormUI({ onSubmit: handleRecurringSubmit })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ PROMOTIONAL OFFERS SECTION ═══ */}
      <section ref={promoSectionRef}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-accent" />
            <h2 className="text-base font-semibold text-white">Promotional Offers</h2>
            <span className="text-xs text-slate-500">({offers.length})</span>
          </div>
          <button onClick={() => { resetAll(); setCreateType('PROMOTIONAL'); setTimeout(() => createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100); }}
            className="inline-flex items-center gap-1.5 bg-accent/15 hover:bg-accent/25 text-accent px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* Create form at top of section */}
        {createType === 'PROMOTIONAL' && (
          <div ref={createFormRef} className="bg-white/[0.03] border border-accent/20 rounded-xl p-4 mb-3">
            <h3 className="text-sm font-medium text-white mb-3">New Promotional Offer</h3>
            {PromoFormUI({ onSubmit: handlePromoSubmit })}
          </div>
        )}

        {offers.length === 0 && !createType ? (
          <div className="text-center py-8 text-slate-500 text-sm">No promotional offers yet</div>
        ) : (
          <div className="space-y-2">
            {offers.map(offer => (
              <div key={offer.id}>
                {/* Card */}
                <div className={`bg-white/[0.03] rounded-xl border ${editingId === offer.id ? 'border-accent/30' : 'border-white/[0.07]'} p-3 transition-all`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-sm font-medium text-white">{offer.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${offer.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {offer.isActive ? 'Active' : 'Off'}
                        </span>
                        {offer.appliesTo === 'SPECIAL' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-400">Special Users</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-400">All Users</span>
                        )}
                        <span className="text-[10px] text-emerald-400 font-medium">
                          {offer.discountType === 'PERCENTAGE' ? `${offer.discountValue}%` : `₹${offer.discountValue}`} off
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span>
                          {new Date(offer.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(offer.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                        {offer.timeSlotStart && offer.timeSlotEnd && (
                          <span>{offer.timeSlotStart}–{offer.timeSlotEnd}</span>
                        )}
                        {offer.days?.length > 0 && (
                          <span className="text-sky-400">{offer.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(', ')}</span>
                        )}
                        {offer.machineIds?.length > 0 && (
                          <span>{offer.machineIds.map(m => MACHINE_OPTIONS.find(o => o.id === m)?.label).join(', ')}</span>
                        )}
                        {offer.pitchTypes?.length > 0 && (
                          <span>{offer.pitchTypes.map(p => PITCH_TYPES.find(o => o.id === p)?.label).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => startEditPromo(offer)} title="Edit"
                        className="p-1.5 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleActivePromo(offer)} title={offer.isActive ? 'Deactivate' : 'Activate'}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer text-xs ${offer.isActive ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-slate-500 hover:bg-white/[0.08]'}`}>
                        {offer.isActive ? '✓' : '○'}
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: offer.id, type: 'PROMOTIONAL' })} title="Delete"
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Delete confirm */}
                  {deleteConfirm?.id === offer.id && (
                    <div className="mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
                      <span className="text-xs text-red-200">Delete this offer?</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => setDeleteConfirm(null)} className="px-2.5 py-1 rounded text-xs text-slate-400 hover:text-white cursor-pointer">Cancel</button>
                        <button onClick={() => deletePromo(offer.id)} className="px-2.5 py-1 rounded text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 cursor-pointer">Delete</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edit form directly below card */}
                {editingId === offer.id && editingType === 'PROMOTIONAL' && (
                  <div ref={editFormRef} className="bg-white/[0.03] border border-accent/20 border-t-0 rounded-b-xl p-4 -mt-1">
                    <h3 className="text-sm font-medium text-white mb-3">Edit Promotional Offer</h3>
                    {PromoFormUI({ onSubmit: handlePromoSubmit })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
