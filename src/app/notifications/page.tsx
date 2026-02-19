'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Bell, BellOff, CheckCircle, Clock, Loader2, Info, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchNotifications();
    }
  }, [session]);

  const markAsRead = async (id?: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        if (id) {
          setNotifications(prev => 
            prev.map(n => n.id === id ? { ...n, isRead: true } : n)
          );
        } else {
          setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        }
      }
    } catch (error) {
      console.error('Failed to update notification', error);
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <BellOff className="w-12 h-12 mb-4 opacity-20" />
        <p>Please login to view notifications</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Bell className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Notifications</h1>
            <p className="text-xs text-slate-400">{unreadCount} unread messages</p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAsRead()}
            className="text-xs font-medium text-accent hover:text-accent-light transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Mark all as read
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading notifications...</span>
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] rounded-2xl border border-white/[0.05]">
          <BellOff className="w-12 h-12 text-slate-600 mx-auto mb-4 opacity-20" />
          <p className="text-sm text-slate-400 font-medium">No notifications yet</p>
          <p className="text-xs text-slate-500 mt-1">We'll notify you here about your bookings.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.isRead && markAsRead(n.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                n.isRead 
                  ? 'bg-white/[0.02] border-white/[0.05] opacity-75' 
                  : 'bg-white/[0.06] border-white/[0.1] shadow-lg shadow-black/10'
              }`}
            >
              <div className="flex gap-3">
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                  n.type === 'ALERT' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                }`}>
                  {n.type === 'ALERT' ? <AlertCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className={`text-sm font-bold truncate ${n.isRead ? 'text-slate-300' : 'text-white'}`}>
                      {n.title}
                    </h3>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 flex-shrink-0 ml-2">
                      <Clock className="w-3 h-3" />
                      {format(new Date(n.createdAt), 'MMM d, h:mm a')}
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed ${n.isRead ? 'text-slate-500' : 'text-slate-300'}`}>
                    {n.message}
                  </p>
                </div>
                {!n.isRead && (
                  <div className="w-2 h-2 rounded-full bg-accent mt-1.5 flex-shrink-0"></div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
