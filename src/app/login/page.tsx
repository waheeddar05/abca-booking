'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Star, Phone, Instagram } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="flex flex-col min-h-screen bg-[#0a1628] relative overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.10),transparent_60%)]"></div>

      {/* Cricket ball SVG - top right */}
      <div className="absolute top-16 right-6 md:right-20 opacity-[0.06] animate-spin-slow pointer-events-none">
        <svg width="100" height="100" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="60" cy="60" r="55" stroke="#d4a843" strokeWidth="2" fill="none"/>
          <path d="M25 60 C35 30, 85 30, 95 60" stroke="#d4a843" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
          <path d="M25 60 C35 90, 85 90, 95 60" stroke="#d4a843" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
        </svg>
      </div>

      {/* Stumps SVG - bottom left */}
      <div className="absolute bottom-20 left-6 md:left-20 opacity-[0.05] pointer-events-none">
        <svg width="60" height="100" viewBox="0 0 80 140" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="15" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
          <rect x="38" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
          <rect x="61" y="20" width="4" height="120" fill="#d4a843" rx="2"/>
          <rect x="10" y="18" width="26" height="4" fill="#d4a843" rx="1"/>
          <rect x="44" y="18" width="26" height="4" fill="#d4a843" rx="1"/>
        </svg>
      </div>

      {/* Another cricket ball - bottom right, smaller */}
      <div className="absolute bottom-32 right-10 opacity-[0.04] pointer-events-none">
        <svg width="50" height="50" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="60" cy="60" r="55" stroke="#fff" strokeWidth="2" fill="none"/>
          <path d="M25 60 C35 30, 85 30, 95 60" stroke="#fff" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
          <path d="M25 60 C35 90, 85 90, 95 60" stroke="#fff" strokeWidth="1.5" fill="none" strokeDasharray="4 3"/>
        </svg>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 relative z-10">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-accent/10 border border-accent/20">
            <Star className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-accent tracking-wide uppercase">Ankeet Bawane Cricket Academy</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            Welcome Back
          </h1>
          <p className="text-sm text-slate-400">
            Sign in to book your practice session
          </p>
        </div>

        {/* Login Card */}
        <div className="w-full max-w-sm animate-fade-in delay-100">
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-white/[0.08] p-6 md:p-8 space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* Google Sign In */}
            <button
              onClick={async () => {
                setLoading(true);
                setError('');
                try {
                  await signIn('google', { callbackUrl: '/slots' });
                } catch {
                  setError('Failed to sign in. Please try again.');
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-white/[0.1] rounded-xl hover:bg-white/[0.06] font-medium text-white transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              <span className="text-sm">{loading ? 'Signing in...' : 'Continue with Google'}</span>
            </button>

            {/* Quick features */}
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="text-center">
                <p className="text-lg font-bold text-accent">4</p>
                <p className="text-[9px] text-slate-500">Machines</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-accent">3</p>
                <p className="text-[9px] text-slate-500">Pitch Types</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-accent">30m</p>
                <p className="text-[9px] text-slate-500">Sessions</p>
              </div>
            </div>
          </div>

          <p className="text-center mt-6 text-sm text-accent/80 font-semibold italic">
            &ldquo;Sweat in Practice. Shine in Matches.&rdquo;
          </p>

          {/* Contact */}
          <div className="flex flex-col items-center gap-2 mt-6 text-xs text-slate-500">
            <div className="flex items-center gap-4">
              <a href="tel:7058683664" className="flex items-center gap-1.5 hover:text-accent transition-colors">
                <Phone className="w-3 h-3" />
                7058683664
              </a>
              <a href="tel:7774077995" className="flex items-center gap-1.5 hover:text-accent transition-colors">
                <Phone className="w-3 h-3" />
                7774077995
              </a>
            </div>
            <a
              href="https://www.instagram.com/ankeetbawanecricketacademy?igsh=MWFvd2p0MzlrOWQ1Mg%3D%3D"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-accent transition-colors"
            >
              <Instagram className="w-3 h-3" />
              @ankeetbawanecricketacademy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
