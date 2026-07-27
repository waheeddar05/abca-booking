'use client';

/**
 * Read-only detail view for a single ledger entry.
 *
 * The list deliberately shows only what fits a phone without sideways
 * scrolling — date, category, amount, method, who handled the money.
 * Everything else (customer or description, vendor, session timing,
 * remarks, who recorded it) lives here, one tap away.
 *
 * Edit and Delete are offered from this view too, so opening an entry
 * to check it doesn't mean closing it again to act on it. Both are
 * gated by the same rules the list uses — the API re-checks regardless.
 */

import { Pencil, Trash2, X } from 'lucide-react';
import {
  LEDGER_PAYMENT_METHOD_LABELS,
  expenseSubcategoryLabel,
  ledgerCategoryLabel,
  type LedgerExpenseCategoryId,
  type LedgerPaymentMethodId,
} from '@/lib/ledger';
import type { LedgerEntry } from './types';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function personName(p: { name: string | null; email: string | null } | null | undefined): string {
  return p?.name || p?.email || '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-slate-200 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

interface Props {
  entry: LedgerEntry;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function LedgerDetailDialog({
  entry,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onClose,
}: Props) {
  const isRevenue = entry.kind === 'REVENUE';
  const session =
    entry.serviceDate || entry.serviceStartTime
      ? [
          entry.serviceDate ? formatDate(entry.serviceDate) : '',
          entry.serviceStartTime
            ? entry.serviceEndTime
              ? `${entry.serviceStartTime} – ${entry.serviceEndTime}`
              : entry.serviceStartTime
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : '';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-white/[0.08] bg-[#0b1726] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07] bg-[#0b1726]">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            {isRevenue ? 'Revenue Entry' : 'Expense Entry'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Amount</p>
            <p
              className={`text-2xl font-bold ${isRevenue ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              ₹{entry.amount.toLocaleString()}
            </p>
          </div>

          <div>
            <Row label="Category" value={ledgerCategoryLabel(entry)} />
            {!isRevenue && entry.expenseSubcategory && (
              <Row
                label="Subcategory"
                value={expenseSubcategoryLabel(
                  entry.expenseCategory as LedgerExpenseCategoryId | null,
                  entry.expenseSubcategory,
                )}
              />
            )}
            {isRevenue ? (
              <Row label="Customer" value={entry.customerName || '—'} />
            ) : (
              <>
                <Row label="Description" value={entry.description || '—'} />
                <Row label="Paid To" value={entry.paidTo || '—'} />
              </>
            )}
            <Row
              label={isRevenue ? 'Received On' : 'Paid On'}
              value={`${formatDate(entry.entryDate)} · ${entry.entryTime}`}
            />
            <Row
              label="Payment Method"
              value={
                LEDGER_PAYMENT_METHOD_LABELS[entry.paymentMethod as LedgerPaymentMethodId] ||
                entry.paymentMethod
              }
            />
            <Row
              label={isRevenue ? 'Collected By' : 'Expense Made By'}
              value={personName(entry.collectedBy)}
            />
            {isRevenue && <Row label="Session" value={session || '—'} />}
            <Row label="Remarks" value={entry.remarks || '—'} />
            <Row label="Recorded By" value={personName(entry.recordedBy)} />
          </div>

          {(canEdit || canDelete) && (
            <div className="flex items-center justify-end gap-2 pt-1">
              {canDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-900 bg-accent hover:brightness-110 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
