'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn } from 'next-auth/react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => setVisible(true));
      document.body.style.overflow = 'hidden';
    } else {
      setVisible(false);
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center px-4 transition-all duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Decorative floating cricket seam */}
      <div className={`absolute top-[12%] right-[8%] transition-all duration-700 delay-200 ${visible ? 'opacity-[0.06] scale-100' : 'opacity-0 scale-75'}`}>
        <svg width="90" height="90" viewBox="0 0 120 120" fill="none">
          <circle cx="60" cy="60" r="55" stroke="#38bdf8" strokeWidth="1.5" fill="none" />
          <path d="M25 60 C35 30, 85 30, 95 60" stroke="#38bdf8" strokeWidth="1.2" fill="none" strokeDasharray="4 3" />
          <path d="M25 60 C35 90, 85 90, 95 60" stroke="#38bdf8" strokeWidth="1.2" fill="none" strokeDasharray="4 3" />
        </svg>
      </div>

      {/* Modal Card */}
      <div
        className={`relative w-full max-w-[340px] md:max-w-sm transition-all duration-300 ease-out ${
          visible ? 'translate-y-0 scale-100' : 'translate-y-6 scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow behind card */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-accent/20 via-transparent to-purple-500/10 blur-sm -z-10" />

        <div className="bg-[#0a0f1e]/95 backdrop-blur-xl rounded-2xl border border-white/[0.08] overflow-hidden shadow-[0_0_80px_rgba(56,189,248,0.08)]">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all z-10 cursor-pointer"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>

          {/* Top accent strip */}
          <div className="h-[2px] bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

          <div className="p-5 md:p-7 pt-6 md:pt-8 space-y-4">
            {/* Header */}
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/playorbit-logo.png"
                alt="PlayOrbit"
                className="h-14 md:h-16 w-auto object-contain mx-auto mb-3 drop-shadow-[0_0_20px_rgba(56,189,248,0.3)]"
              />
              <h2 className="text-base md:text-lg font-black text-white tracking-tight">
                SIGN IN TO PLAY
              </h2>
              <p className="text-[11px] md:text-xs text-slate-500 mt-0.5">
                Book your next practice session
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* Google Sign In Button */}
            <button
              onClick={async () => {
                setLoading(true);
                setError('');
                try {
                  await signIn('google', { callbackUrl: '/verify-mobile' });
                } catch {
                  setError('Sign-in failed. Please try again.');
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] hover:border-white/[0.15] hover:shadow-[0_0_20px_rgba(255,255,255,0.04)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                className="w-5 h-5"
              />
              <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Stats</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-1">
              <div className="text-center py-1.5 rounded-lg bg-white/[0.02]">
                <p className="text-sm font-black text-accent tabular-nums">4</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Machines</p>
              </div>
              <div className="text-center py-1.5 rounded-lg bg-white/[0.02]">
                <p className="text-sm font-black text-accent tabular-nums">3</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Pitches</p>
              </div>
              <div className="text-center py-1.5 rounded-lg bg-white/[0.02]">
                <p className="text-sm font-black text-accent tabular-nums">30m</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Sessions</p>
              </div>
            </div>
          </div>

          {/* Bottom strip */}
          <div className="px-5 md:px-7 py-3 border-t border-white/[0.04] bg-white/[0.01]">
            <p className="text-center text-[10px] text-slate-600 font-bold italic">
              &ldquo;Sweat in Practice. Shine in Matches.&rdquo;
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
