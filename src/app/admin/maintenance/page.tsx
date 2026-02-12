'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Wrench,
  Save,
  Loader2,
  ShieldAlert,
  Users,
  UserCheck,
  AlertTriangle,
  Check,
  Search,
} from 'lucide-react';

interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface MaintenanceSettings {
  enabled: boolean;
  message: string;
  allowAllAdmins: boolean;
  allowedEmails: string[];
}

const SUPER_ADMIN_EMAIL = 'waheeddar8@gmail.com';

export default function MaintenanceManagement() {
  const { data: session } = useSession();
  const router = useRouter();
  const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

  const [settings, setSettings] = useState<MaintenanceSettings>({
    enabled: false,
    message: 'We are currently undergoing scheduled maintenance. Please check back soon.',
    allowAllAdmins: false,
    allowedEmails: [],
  });

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    if (session && !isSuperAdmin) {
      router.push('/admin');
    }
  }, [session, isSuperAdmin, router]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchSettings();
    }
  }, [isSuperAdmin]);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/admin/maintenance');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setAdmins(data.admins.filter((a: AdminUser) => a.email !== SUPER_ADMIN_EMAIL));
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to fetch maintenance settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setStatusMessage({ text: '', type: '' });
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setStatusMessage({ text: 'Maintenance settings saved successfully', type: 'success' });
      } else {
        const data = await res.json();
        setStatusMessage({ text: data.error || 'Failed to save settings', type: 'error' });
      }
    } catch {
      setStatusMessage({ text: 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function toggleEmailAccess(email: string) {
    setSettings(prev => {
      const exists = prev.allowedEmails.includes(email);
      return {
        ...prev,
        allowedEmails: exists
          ? prev.allowedEmails.filter(e => e !== email)
          : [...prev.allowedEmails, email],
      };
    });
  }

  const filteredAdmins = admins.filter(a =>
    !adminSearch ||
    a.name?.toLowerCase().includes(adminSearch.toLowerCase()) ||
    a.email?.toLowerCase().includes(adminSearch.toLowerCase())
  );

  const filteredUsers = users.filter(u =>
    !userSearch ||
    u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-slate-400">Only super admin can access maintenance settings.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading maintenance settings...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Wrench className="w-5 h-5 text-amber-400" />
        <h1 className="text-xl font-bold text-white">Maintenance Mode</h1>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Enable Maintenance Mode</p>
            <p className="text-xs text-slate-400 mt-0.5">
              When enabled, only authorized users can access the application
            </p>
          </div>
          <button
            onClick={() => setSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative w-14 h-8 rounded-full transition-colors cursor-pointer ${
              settings.enabled ? 'bg-amber-500' : 'bg-white/[0.1]'
            }`}
          >
            <span className={`absolute top-1.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              settings.enabled ? 'left-7' : 'left-1.5'
            }`} />
          </button>
        </div>

        {settings.enabled && (
          <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300">
                Maintenance mode is active. Non-authorized users will see the maintenance page and cannot access the application.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Maintenance Message */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3">Maintenance Message</h2>
        <p className="text-xs text-slate-400 mb-2">This message will be shown to users on the maintenance page</p>
        <textarea
          value={settings.message}
          onChange={e => setSettings(prev => ({ ...prev, message: e.target.value }))}
          rows={3}
          className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
          placeholder="Enter a message to show during maintenance..."
        />
      </div>

      {/* Access Control */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4">Access Control</h2>

        {/* Super Admin Notice */}
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 mb-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-green-400 shrink-0" />
            <p className="text-xs text-green-300">
              Super admin ({SUPER_ADMIN_EMAIL}) always has access during maintenance mode.
            </p>
          </div>
        </div>

        {/* Allow All Admins Toggle */}
        <div className="flex items-center justify-between py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-300">Allow All Admins</p>
              <p className="text-xs text-slate-500">Grant access to all admin users during maintenance</p>
            </div>
          </div>
          <button
            onClick={() => setSettings(prev => ({ ...prev, allowAllAdmins: !prev.allowAllAdmins }))}
            className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${
              settings.allowAllAdmins ? 'bg-primary' : 'bg-white/[0.1]'
            }`}
          >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              settings.allowAllAdmins ? 'left-6' : 'left-1'
            }`} />
          </button>
        </div>

        {/* Select Specific Admins */}
        {!settings.allowAllAdmins && admins.length > 0 && (
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <UserCheck className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-medium text-slate-300">Select Specific Admins</p>
            </div>
            <p className="text-xs text-slate-500 mb-3">Choose which admin users can access the site during maintenance</p>

            {admins.length > 4 && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={adminSearch}
                  onChange={e => setAdminSearch(e.target.value)}
                  placeholder="Search admins..."
                  className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
            )}

            <div className="space-y-1 max-h-60 overflow-y-auto">
              {filteredAdmins.map(admin => {
                const isAllowed = admin.email ? settings.allowedEmails.includes(admin.email) : false;
                return (
                  <button
                    key={admin.id}
                    onClick={() => admin.email && toggleEmailAccess(admin.email)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left ${
                      isAllowed
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
                      {admin.image ? (
                        <Image src={admin.image} alt="" width={32} height={32} className="rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-xs font-bold text-slate-400">
                          {(admin.name || admin.email || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-300 truncate">{admin.name || 'Unnamed'}</p>
                      <p className="text-xs text-slate-500 truncate">{admin.email}</p>
                    </div>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                      isAllowed ? 'bg-primary border-primary' : 'border-white/[0.15]'
                    }`}>
                      {isAllowed && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                );
              })}
              {filteredAdmins.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-3">No admins found</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Select Specific Users */}
      {users.length > 0 && (
        <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Allow Specific Users</h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">Choose which regular users can access the site during maintenance</p>

          {users.length > 4 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
              />
            </div>
          )}

          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filteredUsers.map(user => {
              const isAllowed = user.email ? settings.allowedEmails.includes(user.email) : false;
              return (
                <button
                  key={user.id}
                  onClick={() => user.email && toggleEmailAccess(user.email)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left ${
                    isAllowed
                      ? 'bg-primary/10 border border-primary/20'
                      : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 overflow-hidden">
                    {user.image ? (
                      <Image src={user.image} alt="" width={32} height={32} className="rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="text-xs font-bold text-slate-400">
                        {(user.name || user.email || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-300 truncate">{user.name || 'Unnamed'}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                    isAllowed ? 'bg-primary border-primary' : 'border-white/[0.15]'
                  }`}>
                    {isAllowed && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              );
            })}
            {filteredUsers.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-3">No users found</p>
            )}
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] p-5">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
          {statusMessage.text && (
            <span className={`text-sm ${statusMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {statusMessage.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
