'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

export default function OtpPage() {
  const [otp, setOtp] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const mobile = localStorage.getItem('temp_mobile');
    if (!mobile) {
      router.push('/login');
    } else {
      setMobileNumber(mobile);
    }
  }, [router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber, otp }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Invalid OTP');
      }

      localStorage.removeItem('temp_mobile');
      router.push('/slots');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0a1628]">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#132240] to-[#0d1f3c]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,168,67,0.08),transparent_60%)]"></div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 relative z-10">
        <div className="w-full max-w-sm">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-accent" />
            </div>
          </div>

          <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-white/[0.08] p-6 md:p-8">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold text-white mb-1">Verify Your Number</h1>
              <p className="text-sm text-slate-400">
                Enter the 6-digit code sent to{' '}
                <span className="font-semibold text-accent">{mobileNumber}</span>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <input
                  ref={inputRef}
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-4 bg-white/[0.04] border-2 border-white/[0.1] rounded-xl text-center text-2xl tracking-[0.4em] font-mono text-white outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/10 placeholder:text-slate-600"
                  placeholder="------"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full py-3.5 bg-accent hover:bg-accent-light text-primary rounded-xl font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </form>

            <button
              onClick={() => router.push('/login')}
              className="flex items-center justify-center gap-1.5 w-full mt-4 py-2 text-sm text-slate-400 hover:text-accent transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
