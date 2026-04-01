'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  UserCog, Search, Loader2, Trash2, Wallet, CreditCard,
  AlertTriangle, CalendarX, CalendarCheck, CheckCircle2,
  RefreshCw, Eraser, Plus, Minus, DollarSign, Bell, Zap
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { useToast } from '@/components/ui/Toast';

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

interface UserResult {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  image: string | null;
  authProvider: string;
  role: string;
  isBlacklisted: boolean;
  isFreeUser: boolean;
  createdAt: string;
  _count: { bookings: number };
}

interface CleanupSummary {
  allBookings: number;
  cancelledBookings: number;
  bookedBookings: number;
  doneBookings: number;
  payments: number;
  refunds: number;
  packageBookings: number;
  walletBalance: number;
  walletTransactions: number;
  operatedBookings: number;
  notifications: number;
}

interface SelectedUser {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  role: string;
}

export default function UserManagementPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const toast = useToast();

  const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL;

  // Search state
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Selected user state
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
  const [summary, setSummary] = useState<CleanupSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Wallet input
  const [walletAmount, setWalletAmount] = useState('');
  const [walletDescription, setWalletDescription] = useState('');

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    warning?: string;
    variant?: 'default' | 'danger';
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Redirect if not super admin
  useEffect(() => {
    if (session && !isSuperAdmin) {
      router.push('/admin');
    }
  }, [session, isSuperAdmin, router]);

  // Search users
  useEffect(() => {
    if (!search.trim()) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/admin/users?search=${encodeURIComponent(search)}`);
        if (res.ok) {
          const data = await res.json();
          setUsers(data);
        }
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch cleanup summary for selected user
  const fetchSummary = async (userId: string) => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/admin/user-cleanup?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedUser(data.user);
        setSummary(data.summary);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to load user data');
      }
    } catch {
      toast.error('Failed to load user data');
    } finally {
      setSummaryLoading(false);
    }
  };

  const selectUser = (user: UserResult) => {
    setSelectedUser({
      id: user.id,
      name: user.name,
      email: user.email,
      mobileNumber: user.mobileNumber,
      role: user.role,
    });
    setSummary(null);
    fetchSummary(user.id);
  };

  const executeAction = async (action: string, extra?: Record<string, string | number | boolean>) => {
    if (!selectedUser) return;
    setActionLoading(action);
    try {
      const res = await fetch('/api/admin/user-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, action, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Action completed');
        // Refresh summary
        fetchSummary(selectedUser.id);
      } else {
        toast.error(data.error || 'Action failed');
      }
    } catch {
      toast.error('Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const confirmAction = (
    action: string,
    title: string,
    message: string,
    warning?: string,
    extra?: Record<string, string | number | boolean>
  ) => {
    setPendingConfirm({
      title,
      message,
      warning,
      variant: 'danger',
      confirmLabel: 'Confirm',
      onConfirm: () => executeAction(action, extra),
    });
  };

  const userName = selectedUser?.name || selectedUser?.email || 'this user';

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <AlertTriangle className="w-5 h-5 mr-2" />
        <span className="text-sm">Super admin access required</span>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        icon={UserCog}
        title="User Management"
        description="Cleanup bookings, manage wallets, and more"
        iconColor="text-orange-400"
        iconBg="bg-orange-500/10"
      />

      {/* User Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search user by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
          {searchLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 animate-spin" />
          )}
        </div>

        {/* User list */}
        {users.length > 0 && (
          <div className="mt-2 bg-white/[0.03] border border-white/[0.07] rounded-xl max-h-60 overflow-y-auto">
            {users
              .filter((u) => u.email !== SUPER_ADMIN_EMAIL)
              .map((user) => {
                const isSelected = selectedUser?.id === user.id;
                return (
                  <button
                    key={user.id}
                    onClick={() => selectUser(user)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer border-b border-white/[0.04] last:border-b-0 ${
                      isSelected
                        ? 'bg-accent/10 border-l-2 border-l-accent'
                        : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent">
                        {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{user.name || 'Unnamed'}</p>
                      <p className="text-xs text-slate-400 truncate">{user.email || user.mobileNumber}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        user.role === 'ADMIN'
                          ? 'bg-blue-500/10 text-blue-400'
                          : user.role === 'OPERATOR'
                          ? 'bg-purple-500/10 text-purple-400'
                          : 'bg-white/[0.04] text-slate-400'
                      }`}>
                        {user.role}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">{user._count.bookings} bookings</p>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Selected User Panel */}
      {selectedUser && (
        <div className="space-y-4">
          {/* User Info Header */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">{selectedUser.name || 'Unnamed'}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedUser.email} {selectedUser.mobileNumber ? `· ${selectedUser.mobileNumber}` : ''}
                </p>
              </div>
              <button
                onClick={() => fetchSummary(selectedUser.id)}
                disabled={summaryLoading}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${summaryLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {summaryLoading && !summary ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading user data...</span>
            </div>
          ) : summary ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                <SummaryCard label="All Bookings" value={summary.allBookings} color="text-white" />
                <SummaryCard label="Booked" value={summary.bookedBookings} color="text-green-400" />
                <SummaryCard label="Cancelled" value={summary.cancelledBookings} color="text-red-400" />
                <SummaryCard label="Done" value={summary.doneBookings} color="text-blue-400" />
                <SummaryCard label="Payments" value={summary.payments} color="text-amber-400" />
                <SummaryCard label="Refunds" value={summary.refunds} color="text-purple-400" />
                <SummaryCard label="Wallet" value={`₹${summary.walletBalance}`} color="text-emerald-400" />
                <SummaryCard label="Notifications" value={summary.notifications} color="text-slate-400" />
              </div>

              {/* Booking Cleanup Actions */}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <CalendarX className="w-4 h-4 text-red-400" />
                  Booking Cleanup
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <ActionButton
                    icon={Trash2}
                    label="Delete All Bookings"
                    description={`${summary.allBookings} bookings + related data`}
                    color="red"
                    loading={actionLoading === 'DELETE_ALL_BOOKINGS'}
                    disabled={summary.allBookings === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_ALL_BOOKINGS',
                        'Delete All Bookings',
                        `This will permanently delete all ${summary.allBookings} bookings for ${userName}, including their refunds, package bookings, and operator links.`,
                        'This action cannot be undone!'
                      )
                    }
                  />
                  <ActionButton
                    icon={CalendarX}
                    label="Delete Cancelled"
                    description={`${summary.cancelledBookings} cancelled bookings`}
                    color="orange"
                    loading={actionLoading === 'DELETE_CANCELLED_BOOKINGS'}
                    disabled={summary.cancelledBookings === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_CANCELLED_BOOKINGS',
                        'Delete Cancelled Bookings',
                        `This will permanently delete ${summary.cancelledBookings} cancelled bookings for ${userName} and their related refunds.`
                      )
                    }
                  />
                  <ActionButton
                    icon={CalendarCheck}
                    label="Delete Active (Booked)"
                    description={`${summary.bookedBookings} booked slots`}
                    color="yellow"
                    loading={actionLoading === 'DELETE_BOOKED_BOOKINGS'}
                    disabled={summary.bookedBookings === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_BOOKED_BOOKINGS',
                        'Delete Active Bookings',
                        `This will permanently delete ${summary.bookedBookings} active bookings for ${userName}. These slots will become available again.`,
                        'Active bookings will be lost without cancellation!'
                      )
                    }
                  />
                  <ActionButton
                    icon={CheckCircle2}
                    label="Delete Done"
                    description={`${summary.doneBookings} completed bookings`}
                    color="blue"
                    loading={actionLoading === 'DELETE_DONE_BOOKINGS'}
                    disabled={summary.doneBookings === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_DONE_BOOKINGS',
                        'Delete Done Bookings',
                        `This will permanently delete ${summary.doneBookings} completed bookings for ${userName}.`
                      )
                    }
                  />
                </div>
              </div>

              {/* Other Cleanup Actions */}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Eraser className="w-4 h-4 text-purple-400" />
                  Other Cleanup
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <ActionButton
                    icon={CreditCard}
                    label="Delete All Payments"
                    description={`${summary.payments} payment records`}
                    color="amber"
                    loading={actionLoading === 'DELETE_PAYMENTS'}
                    disabled={summary.payments === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_PAYMENTS',
                        'Delete All Payments',
                        `This will permanently delete ${summary.payments} payment records for ${userName}, including their refund records.`,
                        'Payment history will be permanently lost!'
                      )
                    }
                  />
                  <ActionButton
                    icon={Bell}
                    label="Delete Notifications"
                    description={`${summary.notifications} notifications`}
                    color="slate"
                    loading={actionLoading === 'DELETE_NOTIFICATIONS'}
                    disabled={summary.notifications === 0 || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'DELETE_NOTIFICATIONS',
                        'Delete Notifications',
                        `This will delete all ${summary.notifications} notifications for ${userName}.`
                      )
                    }
                  />
                </div>
              </div>

              {/* Wallet Operations */}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-400" />
                  Wallet Operations
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Current balance: <span className="text-emerald-400 font-semibold">₹{summary.walletBalance}</span>
                  {summary.walletTransactions > 0 && (
                    <span className="text-slate-500"> · {summary.walletTransactions} transactions</span>
                  )}
                </p>

                {/* Clean Wallet */}
                <div className="mb-3">
                  <ActionButton
                    icon={Eraser}
                    label="Clean Wallet"
                    description="Reset to ₹0, delete all transactions"
                    color="red"
                    loading={actionLoading === 'CLEAN_WALLET'}
                    disabled={(summary.walletBalance === 0 && summary.walletTransactions === 0) || !!actionLoading}
                    onClick={() =>
                      confirmAction(
                        'CLEAN_WALLET',
                        'Clean Wallet',
                        `This will reset ${userName}'s wallet balance from ₹${summary.walletBalance} to ₹0 and delete all ${summary.walletTransactions} transaction records.`,
                        'All wallet history will be permanently deleted!'
                      )
                    }
                  />
                </div>

                {/* Wallet amount input */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Amount (₹)</label>
                      <input
                        type="number"
                        placeholder="Enter amount"
                        value={walletAmount}
                        onChange={(e) => setWalletAmount(e.target.value)}
                        min="0"
                        step="1"
                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">Description (optional)</label>
                      <input
                        type="text"
                        placeholder="Reason for change"
                        value={walletDescription}
                        onChange={(e) => setWalletDescription(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={Plus}
                      label="Add Money"
                      color="green"
                      loading={actionLoading === 'ADD_WALLET'}
                      disabled={!walletAmount || Number(walletAmount) <= 0 || !!actionLoading}
                      onClick={() =>
                        confirmAction(
                          'ADD_WALLET',
                          'Add Money to Wallet',
                          `Add ₹${walletAmount} to ${userName}'s wallet?\nNew balance: ₹${summary.walletBalance + Number(walletAmount)}`,
                          undefined,
                          { walletAmount: Number(walletAmount), walletDescription }
                        )
                      }
                    />
                    <ActionButton
                      icon={Minus}
                      label="Subtract"
                      color="orange"
                      loading={actionLoading === 'SUBTRACT_WALLET'}
                      disabled={!walletAmount || Number(walletAmount) <= 0 || !!actionLoading}
                      onClick={() =>
                        confirmAction(
                          'SUBTRACT_WALLET',
                          'Subtract from Wallet',
                          `Subtract ₹${walletAmount} from ${userName}'s wallet?\nNew balance: ₹${Math.max(0, summary.walletBalance - Number(walletAmount))}`,
                          undefined,
                          { walletAmount: Number(walletAmount), walletDescription }
                        )
                      }
                    />
                    <ActionButton
                      icon={DollarSign}
                      label="Set Balance"
                      color="blue"
                      loading={actionLoading === 'SET_WALLET'}
                      disabled={!walletAmount || Number(walletAmount) < 0 || !!actionLoading}
                      onClick={() =>
                        confirmAction(
                          'SET_WALLET',
                          'Set Wallet Balance',
                          `Set ${userName}'s wallet balance to exactly ₹${walletAmount}?\nCurrent: ₹${summary.walletBalance}`,
                          undefined,
                          { walletAmount: Number(walletAmount), walletDescription }
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Nuclear Option */}
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Full Cleanup (Danger Zone)
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Delete ALL data for this user: bookings, payments, refunds, packages, wallet, notifications, and operator links. The user account itself will be kept.
                </p>
                <ActionButton
                  icon={AlertTriangle}
                  label="Full Cleanup — Delete Everything"
                  description="Removes all data except the user account"
                  color="red"
                  loading={actionLoading === 'FULL_CLEANUP'}
                  disabled={!!actionLoading}
                  onClick={() =>
                    confirmAction(
                      'FULL_CLEANUP',
                      'Full User Cleanup',
                      `This will permanently delete ALL data for ${userName}:\n• ${summary.allBookings} bookings\n• ${summary.payments} payments\n• ${summary.refunds} refunds\n• Wallet (₹${summary.walletBalance})\n• ${summary.notifications} notifications\n• Operator links\n\nThe user account itself will be preserved.`,
                      'THIS CANNOT BE UNDONE! All data will be permanently deleted.'
                    )
                  }
                />
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Empty State */}
      {!selectedUser && !search && (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center mx-auto mb-4">
            <UserCog className="w-7 h-7 text-orange-400" />
          </div>
          <h3 className="text-sm font-semibold text-white mb-1">User Management</h3>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Search for a user above to manage their bookings, wallet, and clean up their data.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message || ''}
        warning={pendingConfirm?.warning}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        variant={pendingConfirm?.variant || 'default'}
        onConfirm={() => {
          pendingConfirm?.onConfirm();
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

// Helper Components

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  description,
  color,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  color: 'red' | 'orange' | 'yellow' | 'blue' | 'green' | 'amber' | 'purple' | 'slate';
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    red: 'text-red-400 bg-red-500/10 hover:bg-red-500/20 border-red-500/20',
    orange: 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/20',
    yellow: 'text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/20',
    blue: 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20',
    green: 'text-green-400 bg-green-500/10 hover:bg-green-500/20 border-green-500/20',
    amber: 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20',
    purple: 'text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/20',
    slate: 'text-slate-400 bg-slate-500/10 hover:bg-slate-500/20 border-slate-500/20',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2.5 text-left rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${colorMap[color]}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
      ) : (
        <Icon className="w-4 h-4 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <span className="text-xs font-medium block truncate">{label}</span>
        {description && <span className="text-[10px] opacity-60 block truncate">{description}</span>}
      </div>
    </button>
  );
}
