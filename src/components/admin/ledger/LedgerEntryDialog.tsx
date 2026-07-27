'use client';

/**
 * Create / edit dialog for a ledger entry.
 *
 * One component serves both sides of the book — the `kind` prop decides
 * which half of the form renders (customer + session block for Manual
 * Revenue, vendor + description + subcategory for Expenses). Everything
 * else is shared: amount, payment method, Collected By, when the money
 * moved, and remarks.
 *
 * The session block is revenue-only: a repair bill or a utility payment
 * has no session behind it, so expenses never ask for one.
 *
 * "Recorded By" is not a field: the API stamps it from the session.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  LEDGER_EXPENSE_CATEGORIES,
  LEDGER_EXPENSE_CATEGORY_LABELS,
  LEDGER_EXPENSE_SUBCATEGORIES,
  LEDGER_PAYMENT_METHODS,
  LEDGER_PAYMENT_METHOD_LABELS,
  LEDGER_REVENUE_CATEGORIES,
  LEDGER_REVENUE_CATEGORY_LABELS,
  categoryHasSubcategories,
  type LedgerExpenseCategoryId,
  type LedgerKind,
} from '@/lib/ledger';
import type { LedgerEntry, LedgerPerson } from './types';

const inputClass =
  'w-full bg-slate-900/60 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] disabled:opacity-50';
const labelClass =
  'block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-0.5';

/** IST calendar date as yyyy-MM-dd — the default for a new entry. */
function istToday(): string {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** Current IST wall-clock time as HH:MM. */
function istNowTime(): string {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(11, 16);
}

/** A @db.Date value arrives as an ISO string — take the date part. */
function toDateInput(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

interface FormState {
  revenueCategory: string;
  customerName: string;
  expenseCategory: string;
  expenseSubcategory: string;
  description: string;
  paidTo: string;
  serviceDate: string;
  serviceStartTime: string;
  serviceEndTime: string;
  amount: string;
  entryDate: string;
  entryTime: string;
  paymentMethod: string;
  collectedById: string;
  remarks: string;
}

function blankForm(defaultCollectorId: string): FormState {
  return {
    revenueCategory: 'MACHINE',
    customerName: '',
    expenseCategory: 'REPAIRS_MAINTENANCE',
    expenseSubcategory: 'NET_REPAIR',
    description: '',
    paidTo: '',
    serviceDate: istToday(),
    serviceStartTime: '',
    serviceEndTime: '',
    amount: '',
    entryDate: istToday(),
    entryTime: istNowTime(),
    paymentMethod: 'CASH',
    // Whoever is adding the entry is, by default, whoever handled the
    // money — that is the overwhelmingly common case.
    collectedById: defaultCollectorId,
    remarks: '',
  };
}

function formFromEntry(entry: LedgerEntry, defaultCollectorId: string): FormState {
  return {
    ...blankForm(defaultCollectorId),
    revenueCategory: entry.revenueCategory || 'MACHINE',
    customerName: entry.customerName || '',
    expenseCategory: entry.expenseCategory || 'REPAIRS_MAINTENANCE',
    expenseSubcategory: entry.expenseSubcategory || '',
    description: entry.description || '',
    paidTo: entry.paidTo || '',
    serviceDate: toDateInput(entry.serviceDate),
    serviceStartTime: entry.serviceStartTime || '',
    serviceEndTime: entry.serviceEndTime || '',
    amount: String(entry.amount ?? ''),
    entryDate: toDateInput(entry.entryDate),
    entryTime: entry.entryTime || istNowTime(),
    paymentMethod: entry.paymentMethod,
    // Keep an existing entry's collector even if they've since left the
    // roster — blanking it silently on edit would lose the record.
    collectedById: entry.collectedById || '',
    remarks: entry.remarks || '',
  };
}

interface Props {
  kind: LedgerKind;
  /** Entry being edited, or null to create a new one. */
  entry: LedgerEntry | null;
  /** Center members selectable as "Collected By". */
  collectors: LedgerPerson[];
  /** Current user's id — the default collector on a new entry. */
  viewerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function LedgerEntryDialog({
  kind,
  entry,
  collectors,
  viewerId,
  onClose,
  onSaved,
}: Props) {
  const isRevenue = kind === 'REVENUE';
  // Only default to the viewer if they're actually a selectable member;
  // a super admin acting on a center they don't belong to is not.
  const defaultCollectorId = collectors.some((c) => c.id === viewerId) ? viewerId : '';
  const [form, setForm] = useState<FormState>(() =>
    entry ? formFromEntry(entry, defaultCollectorId) : blankForm(defaultCollectorId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const subcategories = useMemo(
    () => LEDGER_EXPENSE_SUBCATEGORIES[form.expenseCategory as LedgerExpenseCategoryId] ?? [],
    [form.expenseCategory],
  );

  // Keep the subcategory valid whenever the category changes — an
  // orphaned code from the previous category would be rejected server-side.
  useEffect(() => {
    if (isRevenue) return;
    if (subcategories.length === 0) {
      if (form.expenseSubcategory) set('expenseSubcategory', '');
      return;
    }
    if (!subcategories.some((s) => s.value === form.expenseSubcategory)) {
      set('expenseSubcategory', subcategories[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.expenseCategory, isRevenue]);

  // The collector on the edited entry may no longer be an active member.
  // Surface them so the select shows a name rather than falling blank.
  const collectorOptions = useMemo(() => {
    const list = [...collectors];
    if (entry?.collectedBy && !list.some((c) => c.id === entry.collectedBy!.id)) {
      list.push(entry.collectedBy);
    }
    return list;
  }, [collectors, entry]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (isRevenue && form.serviceEndTime && !form.serviceStartTime) {
      setError('Enter a session "From" time as well as the "To" time.');
      return;
    }
    if (
      isRevenue &&
      form.serviceStartTime &&
      form.serviceEndTime &&
      form.serviceEndTime <= form.serviceStartTime
    ) {
      setError('Session "To" time must be after the "From" time.');
      return;
    }

    const shared = {
      amount,
      entryDate: form.entryDate,
      entryTime: form.entryTime,
      paymentMethod: form.paymentMethod,
      collectedById: form.collectedById || null,
      remarks: form.remarks.trim() || null,
    };

    const payload = isRevenue
      ? {
          kind: 'REVENUE' as const,
          revenueCategory: form.revenueCategory,
          customerName: form.customerName.trim(),
          serviceDate: form.serviceDate || null,
          serviceStartTime: form.serviceStartTime || null,
          serviceEndTime: form.serviceEndTime || null,
          ...shared,
        }
      : {
          kind: 'EXPENSE' as const,
          expenseCategory: form.expenseCategory,
          expenseSubcategory: categoryHasSubcategories(
            form.expenseCategory as LedgerExpenseCategoryId,
          )
            ? form.expenseSubcategory
            : null,
          description: form.description.trim(),
          paidTo: form.paidTo.trim() || null,
          ...shared,
        };

    setSaving(true);
    try {
      const res = await fetch(entry ? `/api/admin/ledger/${entry.id}` : '/api/admin/ledger', {
        method: entry ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const title = `${entry ? 'Edit' : 'New'} ${isRevenue ? 'Revenue' : 'Expense'} Entry`;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/[0.08] bg-[#0b1726] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07] bg-[#0b1726]">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {isRevenue ? (
            <>
              <div>
                <label className={labelClass}>Revenue Category</label>
                <select
                  value={form.revenueCategory}
                  onChange={(e) => set('revenueCategory', e.target.value)}
                  className={inputClass}
                >
                  {LEDGER_REVENUE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {LEDGER_REVENUE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Customer Name</label>
                <input
                  value={form.customerName}
                  onChange={(e) => set('customerName', e.target.value)}
                  className={inputClass}
                  placeholder="Who paid?"
                  required
                  maxLength={200}
                />
              </div>

          {/* Session timing — the slot this revenue was earned from,
              recorded as a range so the full duration is captured. All
              optional: plenty of entries have no session behind them.
              Date gets its own row and From/To share the next one — a
              single three-up row squeezed the native date and time
              controls until their values were clipped on a phone. */}
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Session Timing
            </p>
            <div>
              <label className={labelClass}>Date</label>
              <input
                type="date"
                value={form.serviceDate}
                onChange={(e) => set('serviceDate', e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>From</label>
                <input
                  type="time"
                  value={form.serviceStartTime}
                  onChange={(e) => set('serviceStartTime', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>To</label>
                <input
                  type="time"
                  value={form.serviceEndTime}
                  onChange={(e) => set('serviceEndTime', e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              When the session is played — separate from when the money moved. Leave blank if there
              is no session behind this entry.
            </p>
          </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelClass}>Expense Category</label>
                <select
                  value={form.expenseCategory}
                  onChange={(e) => set('expenseCategory', e.target.value)}
                  className={inputClass}
                >
                  {LEDGER_EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {LEDGER_EXPENSE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              {subcategories.length > 0 && (
                <div>
                  <label className={labelClass}>Subcategory</label>
                  <select
                    value={form.expenseSubcategory}
                    onChange={(e) => set('expenseSubcategory', e.target.value)}
                    className={inputClass}
                  >
                    {subcategories.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={labelClass}>Description</label>
                <input
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  className={inputClass}
                  placeholder="What was the money spent on?"
                  required
                  maxLength={500}
                />
              </div>

              <div>
                <label className={labelClass}>Paid To / Vendor</label>
                <input
                  value={form.paidTo}
                  onChange={(e) => set('paidTo', e.target.value)}
                  className={inputClass}
                  placeholder="Optional"
                  maxLength={200}
                />
              </div>
            </>
          )}


          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Amount (₹)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Payment Method</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => set('paymentMethod', e.target.value)}
                className={inputClass}
              >
                {LEDGER_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {LEDGER_PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>
              {isRevenue ? 'Collected By' : 'Paid By'}
            </label>
            <select
              value={form.collectedById}
              onChange={(e) => set('collectedById', e.target.value)}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              {collectorOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.email || 'Unnamed'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Who physically handled the money. Defaults to you.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{isRevenue ? 'Received On' : 'Paid On'}</label>
              <input
                type="date"
                value={form.entryDate}
                onChange={(e) => set('entryDate', e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Time</label>
              <input
                type="time"
                value={form.entryTime}
                onChange={(e) => set('entryTime', e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Remarks</label>
            <textarea
              value={form.remarks}
              onChange={(e) => set('remarks', e.target.value)}
              className={`${inputClass} min-h-[64px] resize-y`}
              placeholder="Optional"
              maxLength={1000}
            />
          </div>

          {entry && (
            <p className="text-[11px] text-slate-500">
              Recorded by {entry.recordedBy?.name || entry.recordedBy?.email || 'Unknown'} — editing
              keeps the original recorder.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-white/[0.05] hover:bg-white/[0.1] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-slate-900 bg-accent hover:brightness-110 disabled:opacity-60 cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {entry ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
