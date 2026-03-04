'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

interface WalletTransaction {
  id: string;
  type: 'CREDIT_REFUND' | 'DEBIT_BOOKING' | 'CREDIT_ADMIN' | 'DEBIT_ADMIN';
  amount: number;
  balance: number;
  description: string | null;
  referenceId: string | null;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const TXN_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: 'credit' | 'debit' }> = {
  CREDIT_REFUND: { label: 'Refund', color: 'text-green-400', bg: 'bg-green-500/10', icon: 'credit' },
  CREDIT_ADMIN: { label: 'Admin Credit', color: 'text-green-400', bg: 'bg-green-500/10', icon: 'credit' },
  DEBIT_BOOKING: { label: 'Booking Payment', color: 'text-red-400', bg: 'bg-red-500/10', icon: 'debit' },
  DEBIT_ADMIN: { label: 'Admin Debit', color: 'text-red-400', bg: 'bg-red-500/10', icon: 'debit' },
};

export default function WalletPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [txnLoading, setTxnLoading] = useState(false);
  const [error, setError] = useState('');
  const [walletDisabled, setWalletDisabled] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      if (res.status === 403) {
        setWalletDisabled(true);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch wallet');
      const data = await res.json();
      setBalance(data.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    }
  }, []);

  const fetchTransactions = useCallback(async (page: number) => {
    setTxnLoading(true);
    try {
      const res = await fetch(`/api/wallet/transactions?page=${page}&limit=20`);
      if (!res.ok) throw new Error('Failed to fetch transactions');
      const data = await res.json();
      setTransactions(data.transactions);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setTxnLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await fetchBalance();
      await fetchTransactions(1);
      setLoading(false);
    }
    init();
  }, [fetchBalance, fetchTransactions]);

  const handleRefresh = async () => {
    setLoading(true);
    setError('');
    await fetchBalance();
    await fetchTransactions(pagination.page);
    setLoading(false);
  };

  if (walletDisabled) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5">
        <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-6 h-6 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300 mb-1">Wallet Not Available</p>
          <p className="text-xs text-slate-400">The wallet feature is currently disabled. Contact support for help.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">My Wallet</h1>
            <p className="text-xs text-slate-400">Balance &amp; transaction history</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-accent/15 via-accent/10 to-accent/5 rounded-2xl border border-accent/20 p-6 mb-6">
        <p className="text-xs font-medium text-accent/70 uppercase tracking-wider mb-1">Available Balance</p>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-white">₹{(balance ?? 0).toLocaleString('en-IN')}</span>
          </div>
        )}
        <p className="text-[10px] text-slate-400 mt-2">
          Wallet credits are applied automatically when booking slots
        </p>
      </div>

      {/* Transactions */}
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-white mb-3">Transaction History</h2>
      </div>

      {error && (
        <div className="text-center py-8">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={handleRefresh} className="mt-3 text-sm text-accent font-medium cursor-pointer">Try again</button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">Loading transactions...</span>
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm font-medium text-slate-300 mb-1">No transactions yet</p>
          <p className="text-xs text-slate-400">Refunds and wallet payments will appear here</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {txnLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            )}
            {transactions.map((txn) => {
              const config = TXN_TYPE_CONFIG[txn.type] || { label: txn.type, color: 'text-slate-400', bg: 'bg-white/[0.04]', icon: 'credit' as const };
              const isCredit = config.icon === 'credit';
              const date = new Date(txn.createdAt);

              return (
                <div
                  key={txn.id}
                  className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-3.5 transition-all hover:bg-white/[0.06]"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
                      {isCredit ? (
                        <ArrowDownLeft className={`w-4 h-4 ${config.color}`} />
                      ) : (
                        <ArrowUpRight className={`w-4 h-4 ${config.color}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-white truncate">{config.label}</p>
                        <span className={`text-sm font-bold ${isCredit ? 'text-green-400' : 'text-red-400'} shrink-0`}>
                          {isCredit ? '+' : '-'}₹{txn.amount.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-[10px] text-slate-500 truncate">
                          {txn.description || 'No description'}
                        </p>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          Bal: ₹{txn.balance.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
                        {' '}
                        {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
              <span className="text-xs text-slate-400">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchTransactions(pagination.page - 1)}
                  disabled={pagination.page <= 1 || txnLoading}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                </button>
                <span className="text-sm text-slate-300 px-2">{pagination.page}</span>
                <button
                  onClick={() => fetchTransactions(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages || txnLoading}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
