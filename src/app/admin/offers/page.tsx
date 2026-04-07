'use client';

import { useState, useEffect } from 'react';
import { Gift, Plus, Pencil, Edit2, Loader2, Trash2, Save, X, Filter } from 'lucide-react';
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
  machineId: string | null;
  oneSlotDiscount: number;
  twoSlotDiscount: number;
  appliesTo: 'ALL' | 'SPECIAL';
}

interface UnifiedOffer {
  id: string;
  type: 'PROMOTIONAL' | 'RECURRING';
  name: string;
  isActive: boolean;
  appliesTo: 'ALL' | 'SPECIAL';
  promotional?: OfferData;
  recurring?: RecurringDiscountRule;
}

const MACHINE_OPTIONS = [
  { id: 'GRAVITY', label: 'Gravity (Leather)' },
  { id: 'YANTRA', label: 'Yantra (Premium)' },
  { id: 'LEVERAGE_INDOOR', label: 'Leverage Indoor' },
  { id: 'LEVERAGE_OUTDOOR', label: 'Leverage Outdoor' },
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

const inputClass = "w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors";

const emptyPromoForm = {
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
  appliesTo: 'ALL' as 'ALL' | 'SPECIAL',
};

const emptyRecurringForm = {
  days: [] as number[],
  slotStartTime: '08:00',
  slotEndTime: '08:30',
  machineId: null as string | null,
  oneSlotDiscount: 0,
  twoSlotDiscount: 0,
  enabled: true,
  appliesTo: 'ALL' as 'ALL' | 'SPECIAL',
};

export default function AdminOffers() {
  // Promotional offers
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Recurring discounts
  const [recurringRules, setRecurringRules] = useState<RecurringDiscountRule[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);
  const [ruleMessage, setRuleMessage] = useState({ text: '', type: '' });

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [offerType, setOfferType] = useState<'PROMOTIONAL' | 'RECURRING'>('PROMOTIONAL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'PROMOTIONAL' | 'RECURRING' | null>(null);

  // Promotional form
  const [promoForm, setPromoForm] = useState(emptyPromoForm);

  // Recurring form
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm);
  const [savingRule, setSavingRule] = useState(false);

  // Filter view
  const [filterView, setFilterView] = useState<'all' | 'promotional' | 'recurring'>('all');

  // Fetch offers
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

  useEffect(() => {
    fetchOffers();
    fetchRecurringRules();
  }, []);

  // Build unified list
  const unifiedOffers: UnifiedOffer[] = [
    ...offers.map(o => ({
      id: o.id,
      type: 'PROMOTIONAL' as const,
      name: o.name,
      isActive: o.isActive,
      appliesTo: o.appliesTo,
      promotional: o,
    })),
    ...recurringRules.map(r => ({
      id: r.id,
      type: 'RECURRING' as const,
      name: `${r.slotStartTime}-${r.slotEndTime} (${r.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(',')})`,
      isActive: r.enabled,
      appliesTo: r.appliesTo,
      recurring: r,
    })),
  ];

  const filteredOffers = unifiedOffers.filter(o => {
    if (filterView === 'promotional') return o.type === 'PROMOTIONAL';
    if (filterView === 'recurring') return o.type === 'RECURRING';
    return true;
  });

  // Reset forms
  const resetForms = () => {
    setPromoForm(emptyPromoForm);
    setRecurringForm(emptyRecurringForm);
    setEditingId(null);
    setEditingType(null);
    setOfferType('PROMOTIONAL');
    setShowForm(false);
    setMessage({ text: '', type: '' });
    setRuleMessage({ text: '', type: '' });
  };

  // Promotional offer handlers
  const handlePromoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (!promoForm.name.trim()) {
      setMessage({ text: 'Offer name is required', type: 'error' });
      return;
    }
    if (!promoForm.startDate || !promoForm.endDate) {
      setMessage({ text: 'Start and end dates are required', type: 'error' });
      return;
    }
    if (new Date(promoForm.startDate) > new Date(promoForm.endDate)) {
      setMessage({ text: 'Start date must be before end date', type: 'error' });
      return;
    }
    if (promoForm.discountValue <= 0) {
      setMessage({ text: 'Discount value must be positive', type: 'error' });
      return;
    }
    if (promoForm.discountType === 'PERCENTAGE' && promoForm.discountValue > 100) {
      setMessage({ text: 'Percentage discount cannot exceed 100', type: 'error' });
      return;
    }
    if (promoForm.timeSlotStart && promoForm.timeSlotEnd) {
      if (promoForm.timeSlotStart >= promoForm.timeSlotEnd) {
        setMessage({ text: 'Time slot start must be before end', type: 'error' });
        return;
      }
    }

    setSubmitting(true);
    try {
      const url = editingId && editingType === 'PROMOTIONAL' ? '/api/admin/offers' : '/api/admin/offers';
      const method = editingId && editingType === 'PROMOTIONAL' ? 'PATCH' : 'POST';
      const body = editingId && editingType === 'PROMOTIONAL' ? { id: editingId, ...promoForm } : promoForm;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage({
          text: editingId && editingType === 'PROMOTIONAL' ? 'Offer updated successfully' : 'Offer created successfully',
          type: 'success',
        });
        resetForms();
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

  const startEditPromo = (offer: OfferData) => {
    setPromoForm({
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
      appliesTo: offer.appliesTo || 'ALL',
    });
    setEditingId(offer.id);
    setEditingType('PROMOTIONAL');
    setOfferType('PROMOTIONAL');
    setShowForm(true);
    setMessage({ text: '', type: '' });
  };

  const toggleActivePromo = async (offer: OfferData) => {
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

  // Recurring discount handlers
  const handleSaveRule = async () => {
    if (recurringForm.slotEndTime <= recurringForm.slotStartTime) {
      setRuleMessage({ text: 'End time must be after start time', type: 'error' });
      return;
    }
    if (recurringForm.days.length === 0) {
      setRuleMessage({ text: 'Select at least one day', type: 'error' });
      return;
    }

    setSavingRule(true);
    try {
      const payload = {
        days: recurringForm.days,
        slotStartTime: recurringForm.slotStartTime,
        slotEndTime: recurringForm.slotEndTime,
        machineId: recurringForm.machineId,
        oneSlotDiscount: Number(recurringForm.oneSlotDiscount),
        twoSlotDiscount: Number(recurringForm.twoSlotDiscount),
        enabled: recurringForm.enabled,
        appliesTo: recurringForm.appliesTo,
      };

      let res;
      if (editingId && editingType === 'RECURRING') {
        res = await fetch(`/api/admin/recurring-discounts/${editingId}`, {
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
        setRuleMessage({
          text: editingId && editingType === 'RECURRING' ? 'Rule updated' : 'Rule created',
          type: 'success',
        });
        resetForms();
        fetchRecurringRules();
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

  const startEditRule = (rule: RecurringDiscountRule) => {
    setRecurringForm({
      days: rule.days,
      slotStartTime: rule.slotStartTime,
      slotEndTime: rule.slotEndTime,
      machineId: rule.machineId,
      oneSlotDiscount: rule.oneSlotDiscount,
      twoSlotDiscount: rule.twoSlotDiscount,
      enabled: rule.enabled,
      appliesTo: rule.appliesTo,
    });
    setEditingId(rule.id);
    setEditingType('RECURRING');
    setOfferType('RECURRING');
    setShowForm(true);
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <AdminPageHeader icon={Gift} title="Offers & Discounts" description="Manage promotional offers and recurring discounts">
        <button
          onClick={() => {
            if (showForm) {
              resetForms();
            } else {
              setShowForm(true);
            }
          }}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {showForm ? 'Cancel' : 'Create Offer'}
        </button>
      </AdminPageHeader>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl border border-white/[0.07] p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-5">
            {editingId ? 'Edit Offer' : 'Create New Offer'}
          </h2>

          {/* Offer Type Selector */}
          <div className="mb-6">
            <label className="block text-[11px] font-medium text-slate-400 mb-2">Offer Type</label>
            <div className="flex gap-3">
              {['PROMOTIONAL', 'RECURRING'].map(type => (
                <button
                  key={type}
                  onClick={() => setOfferType(type as 'PROMOTIONAL' | 'RECURRING')}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    offerType === type
                      ? 'bg-accent text-primary'
                      : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]'
                  }`}
                >
                  {type === 'PROMOTIONAL' ? 'Promotional' : 'Recurring'}
                </button>
              ))}
            </div>
          </div>

          {/* Promotional Form */}
          {offerType === 'PROMOTIONAL' && (
            <form onSubmit={handlePromoSubmit} className="space-y-4">
              {message.text && (
                <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {message.text}
                </p>
              )}

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Offer Name *</label>
                <input
                  type="text"
                  value={promoForm.name}
                  onChange={e => setPromoForm({ ...promoForm, name: e.target.value })}
                  placeholder="e.g. Monsoon Discount"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Discount Type *</label>
                  <select
                    value={promoForm.discountType}
                    onChange={e => setPromoForm({ ...promoForm, discountType: e.target.value as 'PERCENTAGE' | 'FIXED' })}
                    className={inputClass}
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
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Discount Value *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={promoForm.discountValue}
                    onChange={e => setPromoForm({ ...promoForm, discountValue: parseFloat(e.target.value) || 0 })}
                    placeholder="10"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={promoForm.startDate}
                    onChange={e => setPromoForm({ ...promoForm, startDate: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">End Date *</label>
                  <input
                    type="date"
                    value={promoForm.endDate}
                    onChange={e => setPromoForm({ ...promoForm, endDate: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Slot Start (Optional)</label>
                  <input
                    type="time"
                    value={promoForm.timeSlotStart || ''}
                    onChange={e => setPromoForm({ ...promoForm, timeSlotStart: e.target.value || null })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Time Slot End (Optional)</label>
                  <input
                    type="time"
                    value={promoForm.timeSlotEnd || ''}
                    onChange={e => setPromoForm({ ...promoForm, timeSlotEnd: e.target.value || null })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Machine (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {MACHINE_OPTIONS.map(machine => (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() =>
                        setPromoForm({
                          ...promoForm,
                          machineId: promoForm.machineId === machine.id ? null : machine.id,
                        })
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        promoForm.machineId === machine.id
                          ? 'bg-accent/20 border border-accent/40 text-accent'
                          : 'bg-white/[0.04] border border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                      }`}
                    >
                      {machine.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Pitch Type (Optional)</label>
                <select
                  value={promoForm.pitchType || ''}
                  onChange={e => setPromoForm({ ...promoForm, pitchType: e.target.value || null })}
                  className={inputClass}
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

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Days of Week (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => {
                        const newDays = promoForm.days.includes(day.id)
                          ? promoForm.days.filter(d => d !== day.id)
                          : [...promoForm.days, day.id].sort((a, b) => a - b);
                        setPromoForm({ ...promoForm, days: newDays });
                      }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        promoForm.days.includes(day.id)
                          ? 'bg-accent/20 border border-accent/40 text-accent'
                          : 'bg-white/[0.04] border border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Applies To</label>
                <select
                  value={promoForm.appliesTo}
                  onChange={e => setPromoForm({ ...promoForm, appliesTo: e.target.value as 'ALL' | 'SPECIAL' })}
                  className={inputClass}
                >
                  <option value="ALL" className="bg-[#1a2a40]">
                    All Users
                  </option>
                  <option value="SPECIAL" className="bg-[#1a2a40]">
                    Special Users Only
                  </option>
                </select>
              </div>

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
                ) : editingId && editingType === 'PROMOTIONAL' ? (
                  'Update Offer'
                ) : (
                  'Create Offer'
                )}
              </button>
            </form>
          )}

          {/* Recurring Form */}
          {offerType === 'RECURRING' && (
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSaveRule();
              }}
              className="space-y-4"
            >
              {ruleMessage.text && (
                <p className={`text-sm ${ruleMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {ruleMessage.text}
                </p>
              )}

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Days of Week *</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map(day => (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => {
                        const newDays = recurringForm.days.includes(day.id)
                          ? recurringForm.days.filter(d => d !== day.id)
                          : [...recurringForm.days, day.id].sort((a, b) => a - b);
                        setRecurringForm({ ...recurringForm, days: newDays });
                      }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        recurringForm.days.includes(day.id)
                          ? 'bg-accent/20 border border-accent/40 text-accent'
                          : 'bg-white/[0.04] border border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={recurringForm.slotStartTime}
                    onChange={e => setRecurringForm({ ...recurringForm, slotStartTime: e.target.value })}
                    step="1800"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={recurringForm.slotEndTime}
                    onChange={e => setRecurringForm({ ...recurringForm, slotEndTime: e.target.value })}
                    step="1800"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-2">Machine (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRecurringForm({ ...recurringForm, machineId: null })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      recurringForm.machineId === null
                        ? 'bg-accent/20 border border-accent/40 text-accent'
                        : 'bg-white/[0.04] border border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                    }`}
                  >
                    All Machines
                  </button>
                  {MACHINE_OPTIONS.map(machine => (
                    <button
                      key={machine.id}
                      type="button"
                      onClick={() =>
                        setRecurringForm({
                          ...recurringForm,
                          machineId: recurringForm.machineId === machine.id ? null : machine.id,
                        })
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        recurringForm.machineId === machine.id
                          ? 'bg-accent/20 border border-accent/40 text-accent'
                          : 'bg-white/[0.04] border border-white/[0.1] text-slate-400 hover:border-white/[0.2]'
                      }`}
                    >
                      {machine.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Applies To</label>
                <select
                  value={recurringForm.appliesTo}
                  onChange={e => setRecurringForm({ ...recurringForm, appliesTo: e.target.value as 'ALL' | 'SPECIAL' })}
                  className={inputClass}
                >
                  <option value="ALL" className="bg-[#1a2a40]">
                    All Users
                  </option>
                  <option value="SPECIAL" className="bg-[#1a2a40]">
                    Special Users Only
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Discount for 1 Slot (₹)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={recurringForm.oneSlotDiscount}
                    onChange={e => setRecurringForm({ ...recurringForm, oneSlotDiscount: Number(e.target.value) || 0 })}
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Discount for 2 Consecutive Slots (₹)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={recurringForm.twoSlotDiscount}
                    onChange={e => setRecurringForm({ ...recurringForm, twoSlotDiscount: Number(e.target.value) || 0 })}
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingRule || recurringForm.days.length === 0}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingRule ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : editingId && editingType === 'RECURRING' ? (
                  'Update Rule'
                ) : (
                  'Create Rule'
                )}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {['all', 'promotional', 'recurring'].map(view => (
          <button
            key={view}
            onClick={() => setFilterView(view as 'all' | 'promotional' | 'recurring')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2 ${
              filterView === view
                ? 'bg-accent text-primary'
                : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]'
            }`}
          >
            <Filter className="w-4 h-4" />
            {view === 'all' ? 'All Offers' : view === 'promotional' ? 'Promotional' : 'Recurring'}
          </button>
        ))}
        <span className="text-slate-500 text-sm py-2">({filteredOffers.length})</span>
      </div>

      {/* Offers List */}
      {loading || recurringLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading offers...</span>
        </div>
      ) : filteredOffers.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Gift className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">No offers configured yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOffers.map(offer => {
            const isPromo = offer.type === 'PROMOTIONAL';
            const data = isPromo ? offer.promotional : offer.recurring;

            if (!data) return null;

            return (
              <div
                key={offer.id}
                className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.08] p-4 hover:border-white/[0.12] transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Title and badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-white">{offer.name}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-accent/15 text-accent">
                        {offer.type === 'PROMOTIONAL' ? 'Promotional' : 'Recurring'}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          offer.isActive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {offer.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          offer.appliesTo === 'SPECIAL' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                        }`}
                      >
                        {offer.appliesTo === 'SPECIAL' ? 'Special Users' : 'All Users'}
                      </span>
                    </div>

                    {/* Details */}
                    {isPromo && offer.promotional && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                            {new Date(offer.promotional.startDate).toLocaleDateString('en-IN')} -{' '}
                            {new Date(offer.promotional.endDate).toLocaleDateString('en-IN')}
                          </span>
                          {offer.promotional.timeSlotStart && offer.promotional.timeSlotEnd && (
                            <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                              {offer.promotional.timeSlotStart} – {offer.promotional.timeSlotEnd}
                            </span>
                          )}
                          <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-medium">
                            {offer.promotional.discountType === 'PERCENTAGE'
                              ? `${offer.promotional.discountValue}% off`
                              : `₹${offer.promotional.discountValue} off`}
                          </span>
                          {offer.promotional.machineId && (
                            <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                              {MACHINE_OPTIONS.find(m => m.id === offer.promotional.machineId)?.label}
                            </span>
                          )}
                          {offer.promotional.pitchType && (
                            <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                              {PITCH_TYPES.find(p => p.id === offer.promotional.pitchType)?.label}
                            </span>
                          )}
                          {offer.promotional.days && offer.promotional.days.length > 0 && (
                            <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                              {offer.promotional.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {!isPromo && offer.recurring && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                            {offer.recurring.slotStartTime} – {offer.recurring.slotEndTime}
                          </span>
                          <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                            {offer.recurring.days.map(d => DAYS_OF_WEEK.find(dw => dw.id === d)?.label).join(', ')}
                          </span>
                          {offer.recurring.machineId && (
                            <span className="bg-white/[0.06] px-2 py-0.5 rounded">
                              {MACHINE_OPTIONS.find(m => m.id === offer.recurring.machineId)?.label}
                            </span>
                          )}
                          <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-medium">
                            1 slot: -₹{offer.recurring.oneSlotDiscount}
                          </span>
                          <span className="bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded font-medium">
                            2 slots: -₹{offer.recurring.twoSlotDiscount}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        if (isPromo && offer.promotional) {
                          startEditPromo(offer.promotional);
                        } else if (!isPromo && offer.recurring) {
                          startEditRule(offer.recurring);
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (isPromo && offer.promotional) {
                          toggleActivePromo(offer.promotional);
                        } else if (!isPromo && offer.recurring) {
                          handleToggleRule(offer.recurring);
                        }
                      }}
                      className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        offer.isActive
                          ? 'text-emerald-400 hover:bg-emerald-400/10'
                          : 'text-slate-500 hover:bg-white/[0.08]'
                      }`}
                      title={offer.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {offer.isActive ? '✓' : '○'}
                    </button>
                    <button
                      onClick={() => {
                        if (isPromo) {
                          setDeleteConfirm(offer.id);
                        } else {
                          handleDeleteRule(offer.id);
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Delete Confirmation for Promotional */}
                {deleteConfirm === offer.id && isPromo && (
                  <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
                    <span className="text-sm text-red-200">Are you sure you want to delete this offer?</span>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
