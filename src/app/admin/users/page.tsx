'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { UserPlus, Trash2, Loader2, Search, Shield, ShieldOff, Users, ChevronDown, ChevronUp, CalendarCheck, Mail, Phone, Clock, X } from 'lucide-react';

interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  mobileNumber: string | null;
  image: string | null;
  authProvider: string;
  role: string;
  createdAt: string;
  _count: { bookings: number };
}

export default function AdminUsers() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [addRole, setAddRole] = useState('USER');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const isSuperAdmin = session?.user?.email === 'waheeddar8@gmail.com';

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
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
  }, [search, roleFilter]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, role: addRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: data.message || 'User added successfully', type: 'success' });
        setEmail('');
        setName('');
        setAddRole('USER');
        setShowAddForm(false);
        fetchUsers();
      } else {
        setMessage({ text: data.error || 'Failed to add user', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const handleToggleRole = async (user: UserData) => {
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN';
    if (!confirm(`Are you sure you want to ${newRole === 'ADMIN' ? 'promote' : 'demote'} ${user.name || user.email} to ${newRole}?`)) return;
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: `User ${newRole === 'ADMIN' ? 'promoted to admin' : 'demoted to user'}`, type: 'success' });
        fetchUsers();
      } else {
        setMessage({ text: data.error || 'Failed to update user', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const handleDeleteUser = async (user: UserData) => {
    if (!confirm(`Are you sure you want to delete ${user.name || user.email}? This will also delete all their bookings. This action cannot be undone.`)) return;
    setMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: 'User deleted successfully', type: 'success' });
        fetchUsers();
      } else {
        setMessage({ text: data.error || 'Failed to delete user', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: 'Internal server error', type: 'error' });
    }
  };

  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'ADMIN').length;
  const userCount = users.filter(u => u.role === 'USER').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Manage Users</h1>
            <p className="text-xs text-slate-400">{totalUsers} total users</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        >
          {showAddForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          <span className="hidden sm:inline">{showAddForm ? 'Close' : 'Add User'}</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <button
          onClick={() => setRoleFilter('')}
          className={`rounded-xl p-3 text-center cursor-pointer transition-all ${
            roleFilter === '' ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.04] border border-white/[0.08]'
          }`}
        >
          <div className="text-lg font-bold text-white">{totalUsers}</div>
          <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">All</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'ADMIN' ? '' : 'ADMIN')}
          className={`rounded-xl p-3 text-center cursor-pointer transition-all ${
            roleFilter === 'ADMIN' ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : 'bg-white/[0.04] border border-white/[0.08]'
          }`}
        >
          <div className="text-lg font-bold text-blue-600">{adminCount}</div>
          <div className="text-[10px] font-medium text-blue-500 uppercase tracking-wider">Admins</div>
        </button>
        <button
          onClick={() => setRoleFilter(roleFilter === 'USER' ? '' : 'USER')}
          className={`rounded-xl p-3 text-center cursor-pointer transition-all ${
            roleFilter === 'USER' ? 'bg-green-500/10 ring-1 ring-green-500/30' : 'bg-white/[0.04] border border-white/[0.08]'
          }`}
        >
          <div className="text-lg font-bold text-green-600">{userCount}</div>
          <div className="text-[10px] font-medium text-green-500 uppercase tracking-wider">Users</div>
        </button>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
          message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Add User Form */}
      {showAddForm && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-5">
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
              {isSuperAdmin && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Role</label>
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 cursor-pointer"
                  >
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
              )}
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

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
          />
        </div>
      </div>

      {/* User List */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading users...</span>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
            <Users className="w-5 h-5 text-slate-500" />
          </div>
          <p className="text-sm text-slate-400">No users found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => {
            const isExpanded = expandedUser === user.id;
            const initial = user.name ? user.name.charAt(0).toUpperCase() : (user.email?.charAt(0).toUpperCase() || '?');

            return (
              <div key={user.id} className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] overflow-hidden">
                {/* Main row */}
                <button
                  onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                  className="w-full flex items-center gap-3 p-4 text-left cursor-pointer hover:bg-white/[0.04] transition-colors"
                >
                  {/* Avatar */}
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

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{user.name || 'Unnamed'}</p>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        user.role === 'ADMIN' ? 'bg-blue-500/10 text-blue-400' : 'bg-white/[0.04] text-slate-400'
                      }`}>
                        {user.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>

                  {/* Booking count */}
                  <div className="text-right flex-shrink-0 mr-1">
                    <div className="text-sm font-bold text-white">{user._count.bookings}</div>
                    <div className="text-[10px] text-slate-500">bookings</div>
                  </div>

                  {/* Expand icon */}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  )}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-white/[0.06]">
                    <div className="grid grid-cols-2 gap-3 pt-3 mb-4">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Mail className="w-3.5 h-3.5 text-slate-500" />
                        <span className="truncate">{user.email || 'No email'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        <span>{user.mobileNumber || 'No phone'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <CalendarCheck className="w-3.5 h-3.5 text-slate-500" />
                        <span>{user._count.bookings} total bookings</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 mb-3">
                      Auth: {user.authProvider} &middot; ID: {user.id.slice(0, 8)}...
                    </div>

                    {/* Actions */}
                    {user.email !== 'waheeddar8@gmail.com' && (
                      <div className="flex gap-2">
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleToggleRole(user)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                              user.role === 'ADMIN'
                                ? 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20'
                                : 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                            }`}
                          >
                            {user.role === 'ADMIN' ? (
                              <>
                                <ShieldOff className="w-3.5 h-3.5" />
                                Demote to User
                              </>
                            ) : (
                              <>
                                <Shield className="w-3.5 h-3.5" />
                                Promote to Admin
                              </>
                            )}
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
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
    </div>
  );
}
