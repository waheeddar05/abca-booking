'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Wrench, ArrowLeft, Power } from 'lucide-react';

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const handleLogout = () => {
    if (session) {
      signOut({ callbackUrl: '/login' });
    } else {
      document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      router.push('/login');
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] overflow-x-hidden">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.05),transparent_60%)]"></div>

      {/* Mobile: Compact header */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 bg-[#0b1726]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent/20 to-green-500/20 flex items-center justify-center">
            <Wrench className="w-3 h-3 text-accent" />
          </div>
          <span className="text-xs font-bold text-white tracking-wide">Operator Panel</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href="/slots"
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] active:scale-95"
          >
            <ArrowLeft className="w-3 h-3" />
            User Mode
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-red-400/70 hover:text-red-400 transition-colors text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] active:scale-95 cursor-pointer"
          >
            <Power className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Desktop: Sidebar */}
        <aside className="hidden md:flex md:flex-col w-56 bg-[#0f1d2f]/60 backdrop-blur-sm border-r border-white/[0.06] min-h-[calc(100vh-64px)]">
          {/* Sidebar Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent/20 to-green-500/20 flex items-center justify-center">
                <Wrench className="w-4 h-4 text-accent" />
              </div>
              <div>
                <h2 className="text-[11px] font-bold text-white tracking-wide">Operator Panel</h2>
                <p className="text-[9px] text-slate-600 font-medium">PlayOrbit</p>
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sidebar Footer */}
          <div className="px-3 py-3 border-t border-white/[0.04] space-y-1.5">
            <Link
              href="/slots"
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" />
              User Mode
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer text-red-400/70 hover:bg-white/[0.04] hover:text-red-400"
            >
              <Power className="w-4 h-4" />
              Logout
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 p-4 pb-24 md:p-6 md:pb-6">
          <div className="max-w-5xl mx-auto overflow-x-hidden">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
