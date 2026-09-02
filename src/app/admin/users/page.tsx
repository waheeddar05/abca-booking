'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useCurrentUser } from '@/lib/current-user';
import { UserPlus, Trash2, Loader2, Search, Users, ChevronDown, ChevronUp, CalendarCheck, Mail, Phone, Clock, X, XCircle, Check, CalendarPlus, History, Wallet } from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { useToast } from '@/components/ui/Toast';
import { useCenter } from '@/lib/center-context';
import { formatCurrency } from '@/lib/format';

interface UserCenterMembership {
  centerId: string;
  role: string;
  isActive: boolean;
  center: { id: string; name: string; slug: string };
}

interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  image: string | null;
  authProvider: string;
  role: string;
  isBlacklisted: boolean;
  isFreeUser: boolean;
  isSpecialUser: boolean;
  specialDiscountType: 'PERCENTAGE' | 'FIXED' | null;
  specialDiscountValue: number | null;
  createdAt: string;
  lastSeen: string | null;
  centerMemberships?: UserCenterMembership[];
  walletBalance: number;
  _count: { bookings: number };
}

export default function AdminUsers() {
  // Profile, not NextAuth session — see @/lib/current-user.
  const { user: currentUser } = useCurrentUser();
  const toast = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [addRole, setAddRole] = useState('USER');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    variant?: 'default' | 'danger';
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [cancelBookingDialog, setCancelBookingDialog] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'date-desc' | 'date-asc'>('date-desc');

  // Booking history modal state
  const [historyUser, setHistoryUser] = useState<UserData | null>(null);
  const [historyBookings, setHistoryBookings] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.isSuperAdmin === true;
  const { currentCenter } = useCenter();
  // Every admin gets an "all users" toggle so they can flip between the
  // users scoped to their current center and the full cross-center list
  // (handy for looking up someone who hasn't booked at this center yet).
  // Defaults to the center-scoped view.
  const [allCenters, setAllCenters] = useState(false);

  const fetchBookingHistory = async (user: UserData) => {
    setHistoryUser(user);
    setHistoryLoading(true);
    try {
      // `userInvolvement=any` includes bookings where this user was the
      // customer, operator, coach, OR sidearm specialist — so an admin
      // reviewing an operator/coach/staff member can see their full
      // schedule, not just sessions they personally booked.
      const res = await fetch(`/api/admin/bookings?userId=${user.id}&userInvolvement=any&limit=100&sortOrder=desc`);
      if (res.ok) {
        const data = await res.json();
        setHistoryBookings(data.bookings || []);
      }
    } catch (e) {
      console.error('Failed to fetch booking history', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleCancelBooking = (bookingId: string) => {
    setCancelBookingDialog(bookingId);
  };

  const executeCancelBooking = async () => {
    const bookingId = cancelBookingDialog;
    if (!bookingId) return;
    setCancelBookingDialog(null);
    setCancellingId(bookingId);
    try {
      const res = await fetch('/api/slots/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
      if (res.ok) {
        toast.success('Booking cancelled successfully');
        if (historyUser) fetchBookingHistory(historyUser);
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to cancel booking');
      }
    } catch {
      toast.error('Failed to cancel booking');
    } finally {
      setCancellingId(null);
    }
  };

  const formatBookingTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      // SPECIAL is client-side filter, don't send to server
      if (roleFilter && roleFilter !== 'SPECIAL') params.set('role', roleFilter);
      // The all-users toggle bypasses the per-center scope and returns
      // every user in the system. Available to any admin.
      if (allCenters) params.set('allCenters', 'true');
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Failed to fetch users', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // Re-fetch when the admin switches centers or flips the all-centers
    // toggle so the list always reflects the active scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, currentCenter?.id, allCenters]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, role: addRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'User added successfully');
        setEmail('');
        setName('');
        setAddRole('USER');
        setShowAddForm(false);
        fetchUsers();
      } else {
        toast.error(data.error || 'Failed to add user');
      }
    } catch {
      toast.error('Internal server error');
    }
  };

  const handleToggleBlacklist = (user: UserData) => {
    const newStatus = !user.isBlacklisted;
    setPendingConfirm({
      title: newStatus ? 'Block User' : 'Unblock User',
      message: `Are you sure you want to ${newStatus ? 'block' : 'unblock'} ${user.name || user.email}?`,
      variant: 'danger',
      confirmLabel: newStatus ? 'Block' : 'Unblock',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/users/blacklist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, isBlacklisted: newStatus }),
          });
          const data = await res.json();
          if (res.ok) {
            toast.success(data.message);
            fetchUsers();
          } else {
            toast.error(data.error || 'Failed to update user');
          }
        } catch {
          toast.error('Internal server error');
        }
      },
    });
  };

  const handleDeleteUser = (user: UserData) => {
    setPendingConfirm({
      title: 'Delete User',
      message: `Are you sure you want to delete ${user.name || user.email}? This will also delete all their bookings. This action cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/users', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id }),
          });
          const data = await res.json();
          if (res.ok) {
            toast.success('User deleted successfully');
            fetchUsers();
          } else {
            toast.error(data.error || 'Failed to delete user');
          }
        } catch {
          toast.error('Internal server error');
        }
      },
    });
  };

  const handleToggleFreeUser = (user: UserData) => {
    const newStatus = !user.isFreeUser;
    setPendingConfirm({
      title: newStatus ? 'Grant Free Booking' : 'Remove Free Booking',
      message: `Are you sure you want to ${newStatus ? 'grant FREE lifetime booking' : 'remove free booking'} for ${user.name || user.email}?`,
      variant: newStatus ? 'default' : 'danger',
      confirmLabel: newStatus ? 'Grant' : 'Remove',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/users', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, isFreeUser: newStatus }),
          });
          const data = await res.json();
          if (res.ok) {
            toast.success(`${user.name || user.email} ${newStatus ? 'now has free lifetime booking' : 'no longer has free booking'}`);
            fetchUsers();
          } else {
            toast.error(data.error || 'Failed to update user');
          }
        } catch {
          toast.error('Internal server error');
        }
      },
    });
  };

  const handleToggleSpecialUser = (user: UserData) => {
    const newStatus = !user.isSpecialUser;
    setPendingConfirm({
      title: newStatus ? 'Mark as Special User' : 'Remove Special User Status',
      message: `Are you sure you want to ${newStatus ? 'mark' : 'remove'} ${user.name || user.email} as a special user?`,
      variant: 'default',
      confirmLabel: newStatus ? 'Mark Special' : 'Remove',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/users', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: user.id,
              isSpecialUser: newStatus,
              ...(newStatus ? { specialDiscountType: 'PERCENTAGE', specialDiscountValue: 0 } : { specialDiscountType: null, specialDiscountValue: null }),
            }),
          });
          const data = await res.json();
          if (res.ok) {
            toast.success(`${user.name || user.email} ${newStatus ? 'marked as special user' : 'removed from special users'}`);
            fetchUsers();
          } else {
            toast.error(data.error || 'Failed to update user');
          }
        } catch {
          toast.error('Internal server error');
        }
      },
    });
  };

  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'ADMIN').length;
  const operatorCount = users.filter(u => u.role === 'OPERATOR').length;
  const userCount = users.filter(u => u.role === 'USER').length;
  const specialCount = users.filter(u => u.isSpecialUser).length;
  // Total wallet liability across every user in the current scope. Blocked
  // users are excluded so the figure reflects funds owed to active users.
  const totalWalletBalance = users.reduce(
    (sum, u) => sum + (u.isBlacklisted ? 0 : (u.walletBalance || 0)),
    0,
  );
  const usersWithBalance = users.filter(u => !u.isBlacklisted && (u.walletBalance || 0) > 0).length;

  // Apply client-side sorting
  const sortedUsers = [...users].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'date-asc':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'date-desc':
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // Apply role filter client-side for SPECIAL (server handles ADMIN/OPERATOR/USER)
  const displayUsers = roleFilter === 'SPECIAL'
    ? sortedUsers.filter(u => u.isSpecialUser)
    : sortedUsers;

  // Description tells the admin exactly which slice of users they're
  // looking at. Without this label admins on multi-center setups had no
  // way to know whether the list was scoped or global.
  const scopeDescription = allCenters
    ? `${totalUsers} users across all centers`
    : currentCenter
      ? `${totalUsers} users at ${currentCenter.name}`
      : `${totalUsers} users`;

  return (
    <div>
      <AdminPageHeader icon={Users} title="Manage Users" description={scopeDescription}>
        <button
          onClick={() => setAllCenters((prev) => !prev)}
          className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
            allCenters
              ? 'bg-purple-500/15 text-purple-200 border-purple-400/40'
              : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-white/[0.16]'
          }`}
          title={allCenters
            ? 'Showing every user in the system. Click to scope back to the current center.'
            : 'Currently scoped to the active center. Click to show every user in the system.'}
        >
          {allCenters ? 'All users' : 'This center'}
        </button>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer shadow-sm shadow-accent/20"
        >
          {showAddForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          <span className="hidden sm:inline">{showAddForm ? 'Close' : 'Add User'}</span>
        </button>
      </AdminPageHeader>

      {/* Total wallet balance — surfaces the platform's outstanding wallet
          liability at a glance so admins don't have to open each user. */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl sm:rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3.5 sm:p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
            <Wallet className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-emerald-300/80 uppercase tracking-wider">Total Wallet Balance</div>
            <div className="text-xs text-slate-400 truncate">
              {usersWithBalance} {usersWithBalance === 1 ? 'user has' : 'users have'} a balance
              {allCenters ? ' across all centers' : currentCenter ? ` at ${currentCenter.name}` : ''}
            </div>
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-emerald-400 flex-shrink-0">
          {formatCurrency(totalWalletBalance)}
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setRoleFilter('')}
          className={`rounded-lg px-2 py-1.5 text-center cursor-pointer transition-all flex-1 min-w-0 ${roleFilter === '' ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.04] border border-white/[0.08]'}`}
        >
          <div className="text-sm font-bold text-white">{totalUsers}</div>
          <div className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">All</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'USER' ? '' : 'USER')}
          className={`rounded-lg px-2 py-1.5 text-center cursor-pointer transition-all flex-1 min-w-0 ${roleFilter === 'USER' ? 'bg-green-500/10 ring-1 ring-green-500/30' : 'bg-white/[0.04] border border-white/[0.08]'}`}
        >
          <div className="text-sm font-bold text-green-600">{userCount}</div>
          <div className="text-[9px] font-medium text-green-500 uppercase tracking-wider">Users</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'SPECIAL' ? '' : 'SPECIAL')}
          className={`rounded-lg px-2 py-1.5 text-center cursor-pointer transition-all flex-1 min-w-0 ${roleFilter === 'SPECIAL' ? 'bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'bg-white/[0.04] border border-white/[0.08]'}`}
        >
          <div className="text-sm font-bold text-cyan-400">{specialCount}</div>
          <div className="text-[9px] font-medium text-cyan-500 uppercase tracking-wider">Special</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'OPERATOR' ? '' : 'OPERATOR')}
          className={`rounded-lg px-2 py-1.5 text-center cursor-pointer transition-all flex-1 min-w-0 ${roleFilter === 'OPERATOR' ? 'bg-purple-500/10 ring-1 ring-purple-500/30' : 'bg-white/[0.04] border border-white/[0.08]'}`}
        >
          <div className="text-sm font-bold text-purple-600">{operatorCount}</div>
          <div className="text-[9px] font-medium text-purple-500 uppercase tracking-wider">Ops</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'ADMIN' ? '' : 'ADMIN')}
          className={`rounded-lg px-2 py-1.5 text-center cursor-pointer transition-all flex-1 min-w-0 ${roleFilter === 'ADMIN' ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : 'bg-white/[0.04] border border-white/[0.08]'}`}
        >
          <div className="text-sm font-bold text-blue-600">{adminCount}</div>
          <div className="text-[9px] font-medium text-blue-500 uppercase tracking-wider">Admin</div>
        </button>
      </div>

      {showAddForm && (
        <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/[0.07] hover:border-white/[0.12] transition-colors p-3.5 sm:p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Add New User</h2>
          <form onSubmit={handleAddUser} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Email *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Name</label>
                <input
                  type="text"
                  placeholder="Full name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Role picker. ADMIN remains super-admin-only; center
                  admins can grant the other staff roles at THEIR center. */}
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Role</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
                >
                  <option value="USER">User</option>
                  <option value="OPERATOR">Operator</option>
                  <option value="COACH">Coach</option>
                  <option value="SIDEARM_SPECIALIST">Sidearm Specialist</option>
                  {isSuperAdmin && <option value="ADMIN">Admin</option>}
                </select>
              </div>
              <div className="flex-1 flex justify-end items-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  Add User
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-3 text-sm text-slate-300 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
        >
          <option value="date-desc" className="bg-[#0f1d2f]">Newest</option>
          <option value="date-asc" className="bg-[#0f1d2f]">Oldest</option>
          <option value="name-asc" className="bg-[#0f1d2f]">A-Z</option>
          <option value="name-desc" className="bg-[#0f1d2f]">Z-A</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading users...</span>
        </div>
      ) : displayUsers.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Users className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">No users found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayUsers.map((user) => {
            const isExpanded = expandedUser === user.id;
            const initial = user.name ? user.name.charAt(0).toUpperCase() : (user.email?.charAt(0).toUpperCase() || '?');

            return (
              <div key={user.id} className="bg-white/[0.03] backdrop-blur-sm rounded-xl sm:rounded-2xl border border-white/[0.07] hover:border-white/[0.12] transition-colors overflow-hidden">
                <button
                  onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                  className="w-full flex items-center gap-3 p-3 sm:p-4 text-left cursor-pointer hover:bg-white/[0.04] transition-colors"
                >
                  {user.image ? (
                    <Image
                      src={user.image}
                      alt={user.name || 'User'}
                      width={40}
                      height={40}
                      className="rounded-full flex-shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-accent">{initial}</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{user.name || 'Unnamed'}</p>
                      {user.isFreeUser && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-green-500/10 text-green-400">
                          Free
                        </span>
                      )}
                      {user.isSpecialUser && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400">
                          Special
                        </span>
                      )}
                      {user.isBlacklisted && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400">
                          Blocked
                        </span>
                      )}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${user.role === 'ADMIN' ? 'bg-blue-500/10 text-blue-400' :
                        user.role === 'OPERATOR' ? 'bg-purple-500/10 text-purple-400' :
                          'bg-white/[0.04] text-slate-400'
                        }`}>
                        {user.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0 mr-1">
                    <span
                      title={`Wallet balance: ${formatCurrency(user.walletBalance)}`}
                      className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-lg whitespace-nowrap leading-none ${user.walletBalance > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.04] text-slate-500'}`}
                    >
                      <Wallet className="w-3 h-3 flex-shrink-0" />
                      <span className="text-xs font-bold tabular-nums">{formatCurrency(user.walletBalance)}</span>
                    </span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-white leading-none tabular-nums">{user._count.bookings}</div>
                      <div className="text-[10px] text-slate-500 leading-none mt-0.5">bookings</div>
                    </div>
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-white/[0.06]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 mb-4">
                      <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                        <Mail className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{user.email || 'No email'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                        <Phone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{user.mobileNumber || 'No phone'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                        <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">
                          {user.lastSeen
                            ? `Last seen ${new Date(user.lastSeen).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : 'Never logged in'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                        <CalendarCheck className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{user._count.bookings} total bookings</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs min-w-0">
                        <Wallet className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className={`truncate ${user.walletBalance > 0 ? 'text-emerald-400 font-medium' : 'text-slate-400'}`}>
                          Wallet balance: {formatCurrency(user.walletBalance)}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 mb-3">
                      Auth: {user.authProvider} &middot; ID: {user.id.slice(0, 8)}...
                    </div>

                    {/* Center memberships — visible in the all-users
                        view so the admin can tell which centers a staff
                        user belongs to. Hidden when the list is already
                        scoped to a single center (would just be repeating
                        the same name on every row). */}
                    {allCenters && user.centerMemberships && user.centerMemberships.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Centers:</span>
                        {user.centerMemberships
                          .filter((m) => m.isActive)
                          .map((m) => (
                            <span
                              key={`${m.centerId}-${m.role}`}
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-500/10 text-indigo-300"
                              title={`${m.role} at ${m.center.name}`}
                            >
                              {m.center.name} · {m.role}
                            </span>
                          ))}
                      </div>
                    )}

                    {user.email !== 'waheeddar8@gmail.com' && (
                      <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Link
                            href={`/slots?userId=${user.id}&userName=${encodeURIComponent(user.name || user.email || '')}`}
                            className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors cursor-pointer"
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                            Book
                          </Link>
                          <button
                            onClick={() => fetchBookingHistory(user)}
                            className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-colors cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            History
                          </button>
                        </div>
                        <button
                          onClick={() => handleToggleBlacklist(user)}
                          className={`flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${user.isBlacklisted
                            ? 'text-green-400 bg-green-500/10 hover:bg-green-500/20'
                            : 'text-red-400 bg-red-500/10 hover:bg-red-500/20'
                            }`}
                        >
                          {user.isBlacklisted ? (
                            <>
                              <Check className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">Unblock User</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">Block User</span>
                            </>
                          )}
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="flex items-center justify-center gap-1 py-2 text-xs font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">Delete</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleSpecialUser(user)}
                          className={`flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${user.isSpecialUser
                            ? 'text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20'
                            : 'text-slate-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1]'
                            }`}
                        >
                          {user.isSpecialUser ? (
                            <span className="truncate">Remove Special User</span>
                          ) : (
                            <span className="truncate">Mark as Special User</span>
                          )}
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleToggleFreeUser(user)}
                            className={`flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${user.isFreeUser
                              ? 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20'
                              : 'text-green-400 bg-green-500/10 hover:bg-green-500/20'
                              }`}
                          >
                            {user.isFreeUser ? (
                              <span className="truncate">Remove Free Booking</span>
                            ) : (
                              <span className="truncate">Grant Free Lifetime Booking</span>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    {user.email === 'waheeddar8@gmail.com' && (
                      <div className="text-[11px] text-slate-500 italic">Super admin - cannot be modified</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Booking History Modal */}
      {historyUser && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setHistoryUser(null)}
        >
          <div
            className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-white/[0.08]">
              <div>
                <h2 className="text-base font-bold text-white">Booking History</h2>
                <p className="text-xs text-slate-400 mt-0.5">{historyUser.name || historyUser.email}</p>
              </div>
              <button
                onClick={() => setHistoryUser(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-sm">Loading bookings...</span>
                </div>
              ) : historyBookings.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarCheck className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No bookings found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {historyBookings.map((booking: any) => {
                    const isBooked = booking.status === 'BOOKED';
                    const isCancelled = booking.status === 'CANCELLED';
                    const isDone = booking.status === 'DONE';
                    const hasPackage = !!booking.packageBooking;

                    // Decide which role this user played in the booking
                    // — drives the small role pill at the top so an admin
                    // can tell at a glance whether they were the customer,
                    // operator, coach, or sidearm specialist.
                    const involvedUserId = historyUser?.id;
                    let involvementRole: 'customer' | 'operator' | 'coach' | 'staff' | null = null;
                    if (involvedUserId) {
                      if (booking.userId === involvedUserId) involvementRole = 'customer';
                      else if (booking.operatorId === involvedUserId) involvementRole = 'operator';
                      else if (booking.assignedCoachId === involvedUserId) involvementRole = 'coach';
                      else if (booking.assignedStaffId === involvedUserId) involvementRole = 'staff';
                    }
                    const involvementLabel =
                      involvementRole === 'operator' ? 'As Operator'
                      : involvementRole === 'coach' ? 'As Coach'
                      : involvementRole === 'staff' ? 'As Sidearm'
                      : involvementRole === 'customer' ? 'As Customer'
                      : null;
                    const involvementColor =
                      involvementRole === 'operator' ? 'bg-purple-500/15 text-purple-300'
                      : involvementRole === 'coach' ? 'bg-amber-500/15 text-amber-300'
                      : involvementRole === 'staff' ? 'bg-cyan-500/15 text-cyan-300'
                      : 'bg-white/[0.06] text-slate-300';

                    // Resource-based machine label falls back to short
                    // name then full name; ABCA rows keep their legacy
                    // enum label.
                    const machineLabel = booking.assignedMachine
                      ? (booking.assignedMachine.shortName || booking.assignedMachine.name)
                      : booking.machineId
                        ? (booking.machineId === 'GRAVITY' ? 'Gravity'
                          : booking.machineId === 'YANTRA' ? 'Yantra'
                          : booking.machineId === 'LEVERAGE_INDOOR' ? 'Tennis Indoor'
                          : booking.machineId === 'LEVERAGE_OUTDOOR' ? 'Tennis Outdoor'
                          : booking.machineId)
                        : null;

                    // Center label — short name if available, else full
                    // name. Hidden on single-center setups where the
                    // admin already knows the context.
                    const centerLabel = booking.center
                      ? (booking.center.shortName || booking.center.name)
                      : null;

                    return (
                      <div
                        key={booking.id}
                        className={`rounded-xl border p-3.5 ${isCancelled
                          ? 'bg-white/[0.02] border-white/[0.04] opacity-70'
                          : 'bg-white/[0.04] border-white/[0.08]'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-semibold text-white">
                                {new Date(booking.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {formatBookingTime(booking.startTime)} - {formatBookingTime(booking.endTime)}
                              </span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${isBooked ? 'bg-green-500/15 text-green-400' :
                                isDone ? 'bg-blue-500/15 text-blue-400' :
                                  'bg-red-500/15 text-red-400'
                                }`}>
                                {booking.status}
                              </span>
                              {involvementLabel && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${involvementColor}`}>
                                  {involvementLabel}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                              {centerLabel && (
                                <span className="bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded font-medium">
                                  {centerLabel}
                                </span>
                              )}
                              {machineLabel && (
                                <span className="bg-white/[0.06] px-1.5 py-0.5 rounded">
                                  {machineLabel}
                                </span>
                              )}
                              {booking.category && booking.category !== 'MACHINE' && (
                                <span className="bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded font-medium">
                                  {booking.category === 'SIDEARM' ? 'Sidearm'
                                    : booking.category === 'COACHING' ? 'Coaching'
                                    : booking.category === 'FULL_COURT' ? 'Full Court'
                                    : booking.category === 'CORPORATE_BATCH' ? 'Corporate'
                                    : booking.category === 'NET' ? 'Net only'
                                    : booking.category}
                                </span>
                              )}
                              {booking.ballType && (
                                <span className="bg-white/[0.06] px-1.5 py-0.5 rounded">
                                  {booking.ballType === 'LEATHER' ? 'Leather Ball' : booking.ballType === 'MACHINE' ? 'Machine Ball' : 'Tennis'}
                                </span>
                              )}
                              {hasPackage && (
                                <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded font-medium">
                                  Package
                                </span>
                              )}
                              {booking.price !== null && booking.price !== undefined && (
                                <span className="text-accent font-medium">₹{booking.price}</span>
                              )}
                            </div>
                            {isCancelled && booking.cancelledBy && (
                              <div className="mt-1.5 text-[10px] text-red-400 flex items-center gap-1">
                                <XCircle className="w-3 h-3" />
                                Cancelled By: <span className="font-medium">{booking.cancelledBy}</span>
                              </div>
                            )}
                            {isCancelled && booking.cancellationReason && (
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Reason: {booking.cancellationReason}
                              </div>
                            )}
                          </div>
                          {isBooked && (
                            <button
                              onClick={() => handleCancelBooking(booking.id)}
                              disabled={cancellingId === booking.id}
                              className="flex-shrink-0 px-2.5 py-1.5 text-[10px] font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {cancellingId === booking.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'Cancel'
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message || ''}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        variant={pendingConfirm?.variant || 'default'}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null); }}
        onCancel={() => setPendingConfirm(null)}
      />
      <ConfirmDialog
        open={!!cancelBookingDialog}
        title="Cancel Booking"
        message="Are you sure you want to cancel this booking?"
        confirmLabel="Cancel Booking"
        variant="danger"
        onConfirm={executeCancelBooking}
        onCancel={() => setCancelBookingDialog(null)}
      />
    </div>
  );
}
