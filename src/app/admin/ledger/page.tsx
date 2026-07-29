'use client';

/**
 * Admin → Ledger.
 *
 * Hand-entered money that the booking engine never sees: cash taken at
 * the desk, off-platform transfers, repair bills, staff payouts. Two
 * tabs over one table — **Manual Revenue** (money in) and **Expenses**
 * (money out) — sharing the same filter bar, list, and CSV export.
 *
 * Open to center ADMIN and MODERATOR alike. Moderators see every entry
 * and can add new ones, but may edit only what they recorded themselves
 * and may never delete. The API reports `canDelete` / `canEditAll` /
 * `viewerId` so the per-row controls match; the server enforces all of
 * it regardless.
 *
 * Manual Revenue feeds the dashboard's Total Revenue and its own card;
 * Expenses get a card of their own and are never netted off revenue.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Download,
  Loader2,
  ChevronRight,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LedgerDetailDialog } from '@/components/admin/ledger/LedgerDetailDialog';
import { LedgerEntryDialog } from '@/components/admin/ledger/LedgerEntryDialog';
import type { LedgerEntry, LedgerListResponse } from '@/components/admin/ledger/types';
import {
  LEDGER_EXPENSE_CATEGORIES,
  LEDGER_EXPENSE_CATEGORY_LABELS,
  LEDGER_PAYMENT_METHODS,
  LEDGER_PAYMENT_METHOD_LABELS,
  LEDGER_REVENUE_CATEGORIES,
  LEDGER_REVENUE_CATEGORY_LABELS,
  ledgerCategoryLabel,
  type LedgerKind,
  type LedgerPaymentMethodId,
} from '@/lib/ledger';

const controlClass =
  'w-full bg-slate-900/50 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]';
const filterLabelClass =
  'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 ml-0.5';

function istYMD(d: Date): string {
  return new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/** Default range: the current IST month to date — same as the dashboard. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
  const firstOfMonth = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1));
  return { from: istYMD(firstOfMonth), to: istYMD(now) };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export default function AdminLedgerPage() {
  const [kind, setKind] = useState<LedgerKind>('REVENUE');
  const [range] = useState(defaultRange);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [category, setCategory] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [recordedById, setRecordedById] = useState('');
  // Who handled the money. Same column on both tabs, labelled "Collected
  // By" for revenue and "Expenses Made By" for expenses — matching the
  // list's own header, which already renames itself per kind.
  const [collectedById, setCollectedById] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<LedgerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [viewing, setViewing] = useState<LedgerEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LedgerEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isRevenue = kind === 'REVENUE';

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ kind });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (category) params.set('category', category);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    if (recordedById) params.set('recordedById', recordedById);
    if (collectedById) params.set('collectedById', collectedById);
    if (debouncedSearch) params.set('q', debouncedSearch);
    params.set('page', String(page));
    return params.toString();
  }, [kind, from, to, category, paymentMethod, recordedById, collectedById, debouncedSearch, page]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/ledger?${queryString}`, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Failed to load entries');
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [queryString, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // Switching tabs resets the category filter — the two kinds don't
  // share a category vocabulary, so carrying it over would 400.
  const switchKind = (next: LedgerKind) => {
    if (next === kind) return;
    setKind(next);
    setCategory('');
    setPage(1);
  };

  // Deleting goes through the app-wide ConfirmDialog rather than the
  // browser's `confirm()`, so it looks and behaves like every other
  // destructive confirmation in PlayOrbit.
  const remove = async (entry: LedgerEntry) => {
    setDeletingId(entry.id);
    try {
      const res = await fetch(`/api/admin/ledger/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setConfirmDelete(null);
      setViewing(null);
      refresh();
    } catch (err) {
      setConfirmDelete(null);
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeletingId(null);
    }
  };

  // A moderator may correct only what they recorded themselves; a full
  // admin may edit anything. Mirrors the PATCH guard exactly — this only
  // decides whether the pencil renders, never whether the edit succeeds.
  const canEdit = (entry: LedgerEntry): boolean =>
    !!data && (data.canEditAll || entry.recordedById === data.viewerId);

  const categoryOptions = isRevenue
    ? LEDGER_REVENUE_CATEGORIES.map((c) => ({ value: c, label: LEDGER_REVENUE_CATEGORY_LABELS[c] }))
    : LEDGER_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: LEDGER_EXPENSE_CATEGORY_LABELS[c] }));

  const entries = data?.entries ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtersDirty =
    from !== range.from ||
    to !== range.to ||
    !!category ||
    !!paymentMethod ||
    !!recordedById ||
    !!collectedById ||
    !!search;

  const resetFilters = () => {
    setFrom(range.from);
    setTo(range.to);
    setCategory('');
    setPaymentMethod('');
    setRecordedById('');
    setCollectedById('');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="space-y-4 pb-10">
      <AdminPageHeader
        icon={BookOpenCheck}
        title="Ledger"
        description="Revenue and expenses recorded by hand — money the booking system never saw."
      >
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-900 bg-accent hover:brightness-110 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          {isRevenue ? 'Add Revenue' : 'Add Expense'}
        </button>
      </AdminPageHeader>

      {/* Kind tabs */}
      <div className="inline-flex rounded-xl bg-white/[0.04] border border-white/[0.07] p-1">
        {(
          [
            { id: 'REVENUE' as const, label: 'Manual Revenue' },
            { id: 'EXPENSE' as const, label: 'Expenses' },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchKind(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              kind === t.id ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className={filterLabelClass}>From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            />
          </div>
          <div>
            <label className={filterLabelClass}>To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            />
          </div>
          <div>
            <label className={filterLabelClass}>Category</label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            >
              <option value="">All</option>
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            >
              <option value="">All</option>
              {LEDGER_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {LEDGER_PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          {/* Who handled the money. The option list comes from the
              entries themselves, so a staff member who has since left the
              center can still be filtered on. */}
          <div>
            <label className={filterLabelClass}>
              {isRevenue ? 'Collected By' : 'Expenses Made By'}
            </label>
            <select
              value={collectedById}
              onChange={(e) => {
                setCollectedById(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            >
              <option value="">Anyone</option>
              {(data?.handlers ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name || h.email || 'Unnamed'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Recorded By</label>
            <select
              value={recordedById}
              onChange={(e) => {
                setRecordedById(e.target.value);
                setPage(1);
              }}
              className={controlClass}
            >
              <option value="">Anyone</option>
              {(data?.recorders ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email || 'Unnamed'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={
                isRevenue ? 'Search customer or remarks…' : 'Search vendor, description or remarks…'
              }
              className={`${controlClass} pl-9`}
            />
          </div>
          {filtersDirty && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white px-3 py-2 bg-white/[0.05] rounded-lg border border-white/[0.05] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
          <a
            href={`/api/admin/ledger/export?${queryString}`}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white px-3 py-2 bg-white/[0.05] rounded-lg border border-white/[0.05]"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Totals for the current filter */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {isRevenue ? 'Revenue in view' : 'Expenses in view'}
          </p>
          <p className={`text-xl font-bold mt-1 ${isRevenue ? 'text-emerald-400' : 'text-rose-400'}`}>
            {loading ? (
              <span className="inline-block w-20 h-6 bg-white/[0.06] rounded animate-pulse" />
            ) : (
              `₹${(data?.totalAmount ?? 0).toLocaleString()}`
            )}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Entries</p>
          <p className="text-xl font-bold text-white mt-1">
            {loading ? (
              <span className="inline-block w-12 h-6 bg-white/[0.06] rounded animate-pulse" />
            ) : (
              (data?.total ?? 0).toLocaleString()
            )}
          </p>
        </div>
      </div>

      {/* Entries — a compact, screen-width list. Only the five fields
          you scan for are shown (date, category, amount, method, who
          handled the money); everything else opens in a detail view on
          tap. The old wide table needed horizontal scrolling on a phone,
          which made the list unusable exactly where it is used most. */}
      <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] overflow-hidden">
        {/* Column headings — desktop only; the mobile cards label
            themselves inline. */}
        <div className="hidden sm:grid grid-cols-[6.5rem_1fr_7rem_6rem_9rem_1.5rem] gap-3 px-4 py-2.5 bg-white/[0.02] text-[10px] font-bold text-slate-500 uppercase">
          <span>Date</span>
          <span>Category</span>
          <span className="text-right">Amount</span>
          <span>Method</span>
          <span>{isRevenue ? 'Collected By' : 'Expense Made By'}</span>
          <span />
        </div>

        <div className="divide-y divide-white/[0.05]">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="px-4 py-3.5 animate-pulse">
                <div className="h-3 bg-white/10 rounded w-1/2" />
              </div>
            ))
          ) : entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500 italic">
              No {isRevenue ? 'revenue' : 'expense'} entries for these filters.
            </p>
          ) : (
            entries.map((e) => {
              const method =
                LEDGER_PAYMENT_METHOD_LABELS[e.paymentMethod as LedgerPaymentMethodId] ||
                e.paymentMethod;
              const handledBy = e.collectedBy?.name || e.collectedBy?.email || '—';
              const amount = (
                <span className={isRevenue ? 'text-emerald-400' : 'text-rose-400'}>
                  ₹{e.amount.toLocaleString()}
                </span>
              );
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setViewing(e)}
                  className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors cursor-pointer"
                >
                  {/* Mobile: two lines, no horizontal overflow. */}
                  <div className="sm:hidden space-y-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-white font-medium truncate">
                        {ledgerCategoryLabel(e)}
                      </span>
                      <span className="text-sm font-bold whitespace-nowrap">{amount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span className="whitespace-nowrap">{formatDate(e.entryDate)}</span>
                      <span className="truncate">
                        {method} · {handledBy}
                      </span>
                    </div>
                  </div>

                  {/* Desktop: the same five fields on one row. */}
                  <div className="hidden sm:grid grid-cols-[6.5rem_1fr_7rem_6rem_9rem_1.5rem] gap-3 items-center text-sm">
                    <span className="text-slate-300 whitespace-nowrap">
                      {formatDate(e.entryDate)}
                    </span>
                    <span className="text-slate-200 truncate">{ledgerCategoryLabel(e)}</span>
                    <span className="text-right font-bold whitespace-nowrap">{amount}</span>
                    <span className="text-slate-400 truncate">{method}</span>
                    <span className="text-slate-400 truncate">{handledBy}</span>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>


      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] disabled:opacity-40 cursor-pointer"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] disabled:opacity-40 cursor-pointer"
          >
            Next
          </button>
        </div>
      )}

      {viewing && (
        <LedgerDetailDialog
          entry={viewing}
          canEdit={canEdit(viewing)}
          canDelete={!!data?.canDelete}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
            setDialogOpen(true);
          }}
          onDelete={() => setConfirmDelete(viewing)}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={isRevenue ? 'Delete revenue entry?' : 'Delete expense entry?'}
        message={
          confirmDelete
            ? `${ledgerCategoryLabel(confirmDelete)} — ₹${confirmDelete.amount.toLocaleString()}${
                isRevenue
                  ? confirmDelete.customerName
                    ? ` from ${confirmDelete.customerName}`
                    : ''
                  : confirmDelete.description
                    ? ` (${confirmDelete.description})`
                    : ''
              }`
            : ''
        }
        warning="This cannot be undone. The entry is removed from the ledger and from the dashboard totals."
        confirmLabel="Delete"
        variant="danger"
        loading={!!deletingId}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {dialogOpen && (
        <LedgerEntryDialog
          kind={kind}
          entry={editing}
          collectors={data?.collectors ?? []}
          viewerId={data?.viewerId ?? ''}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setDialogOpen(false);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
