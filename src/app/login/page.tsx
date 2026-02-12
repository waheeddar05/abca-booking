'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Star, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      setSuccessMessage(data.debugMessage || 'OTP sent successfully!');
      localStorage.setItem('temp_mobile', mobileNumber);
      setTimeout(() => {
        router.push('/otp');
      }, 2000);
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
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-accent/10 border border-accent/20">
            <Star className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-semibold text-accent tracking-wide uppercase">ABCA Cricket</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            Welcome Back
          </h1>
          <p className="text-sm text-slate-400">
            Sign in to book your practice session
          </p>
        </div>

        {/* Login Card */}
        <div className="w-full max-w-sm">
          <div className="bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-white/[0.08] p-6 md:p-8 space-y-5">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {successMessage && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {successMessage}
              </div>
            )}

            {/* Google Sign In */}
            <button
              onClick={() => signIn('google', { callbackUrl: '/slots' })}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-white/[0.1] rounded-xl hover:bg-white/[0.06] font-medium text-white transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              <span className="text-sm">Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.08]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-[#0f1d2f] text-slate-500">or use mobile number</span>
              </div>
            </div>

            {/* Mobile Number Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="mobile" className="block text-xs font-medium text-slate-400 mb-1.5">
                  Mobile Number
                </label>
                <input
                  id="mobile"
                  type="tel"
                  required
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-sm text-white focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none transition-all placeholder:text-slate-500"
                  placeholder="Enter your mobile number"
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-light text-primary rounded-xl font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <span>Sending OTP...</span>
                ) : (
                  <>
                    <span>Send OTP</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center mt-6 text-xs text-slate-500 italic">
            &ldquo;Champions are made in the nets&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
