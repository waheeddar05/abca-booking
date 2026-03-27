'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

type Step = 'mobile' | 'otp' | 'success';

export default function VerifyMobilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#030712]">
        <div className="animate-spin w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full" />
      </div>
    }>
      <VerifyMobileContent />
    </Suspense>
  );
}

function VerifyMobileContent() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefillMobile = searchParams.get('mobile') || '';
  // If mobile is pre-filled from the prompt, skip the mobile step (avoid showing it twice)
  const [step, setStep] = useState<Step>(prefillMobile && /^[6-9]\d{9}$/.test(prefillMobile) ? 'otp' : 'mobile');
  const [mobileNumber, setMobileNumber] = useState(prefillMobile);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [autoSendDone, setAutoSendDone] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if already verified
  useEffect(() => {
    if (status === 'authenticated' && (session?.user as any)?.mobileVerified) {
      router.replace('/slots');
    }
  }, [session, status, router]);

  // Auto-send OTP if mobile number is pre-filled from prompt
  useEffect(() => {
    if (prefillMobile && !autoSendDone && status === 'authenticated' && /^[6-9]\d{9}$/.test(prefillMobile)) {
      setAutoSendDone(true);
      handleSendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillMobile, status, autoSendDone]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Redirect if not authenticated
  if (status === 'unauthenticated') {
    router.replace('/');
    return null;
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030712]">
        <div className="animate-spin w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full" />
      </div>
    );
  }

  const handleSendOtp = async () => {
    if (!isValidMobile) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/whatsapp/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send OTP');
        return;
      }
      setStep('otp');
      setCountdown(60);
      // Focus first OTP input after transition
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (otpOverride?: string[]) => {
    const otpArray = otpOverride || otp;
    const otpString = otpArray.join('');
    if (otpString.length !== 6) {
      setError('Please enter the complete 6-digit OTP');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/whatsapp/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber, otp: otpString }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }
      setStep('success');
      // Update the NextAuth session so mobileVerified is true
      try { await updateSession(); } catch { /* session update is best-effort */ }
      // Redirect after brief success animation — use window.location as fallback
      setTimeout(() => {
        try {
          router.replace('/slots');
        } catch {
          window.location.href = '/slots';
        }
        // Hard fallback if router.replace doesn't navigate
        setTimeout(() => { window.location.href = '/slots'; }, 1000);
      }, 1500);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered — pass newOtp directly to avoid stale closure
    if (value && index === 5 && newOtp.every(d => d !== '')) {
      setTimeout(() => handleVerifyOtp(newOtp), 100);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newOtp = pasted.split('');
      setOtp(newOtp);
      otpRefs.current[5]?.focus();
      e.preventDefault();
    }
  };

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNumber.replace(/\D/g, ''));

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#030712] px-4">
      {/* Decorative background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 -right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Glow */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-accent/20 via-transparent to-purple-500/10 blur-sm -z-10" />

        <div className="bg-[#0a0f1e]/95 backdrop-blur-xl rounded-2xl border border-white/[0.08] overflow-hidden shadow-[0_0_80px_rgba(56,189,248,0.08)]">
          {/* Top accent */}
          <div className="h-[2px] bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

          <div className="p-6 md:p-8 space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/20 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>

              <h1 className="text-lg font-bold text-white">
                {step === 'success' ? 'Verified!' : 'Verify Your Mobile'}
              </h1>
              <p className="text-xs text-slate-500">
                {step === 'mobile' && 'Link your mobile number to continue'}
                {step === 'otp' && countdown === 0 && loading && 'Sending OTP to your WhatsApp...'}
                {step === 'otp' && !(countdown === 0 && loading) && 'Enter the OTP sent to your WhatsApp'}
                {step === 'success' && 'Redirecting to booking...'}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            {/* Step: Mobile Number Input */}
            {step === 'mobile' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2">
                    Mobile Number
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0 text-sm text-slate-500 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5">
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="9876543210"
                      value={mobileNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setMobileNumber(val);
                        setError('');
                      }}
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all"
                      autoFocus
                    />
                  </div>
                </div>

                <button
                  onClick={handleSendOtp}
                  disabled={!isValidMobile || loading}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-green-500/90 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending OTP...
                    </span>
                  ) : (
                    'Send OTP'
                  )}
                </button>

                <p className="text-center text-[10px] text-slate-600">
                  You&apos;ll receive a 6-digit code on WhatsApp
                </p>
              </div>
            )}

            {/* Step: OTP Input */}
            {step === 'otp' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">+91 {mobileNumber}</span>
                  <button
                    onClick={() => { setStep('mobile'); setOtp(['', '', '', '', '', '']); setError(''); }}
                    className="text-xs text-accent hover:text-accent/80 cursor-pointer"
                  >
                    Change
                  </button>
                </div>

                {/* OTP boxes */}
                <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className="w-11 h-12 text-center text-lg font-bold bg-white/[0.04] border border-white/[0.1] text-white rounded-lg focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                    />
                  ))}
                </div>

                <button
                  onClick={handleVerifyOtp}
                  disabled={otp.some(d => d === '') || loading}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-green-500/90 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Verifying...
                    </span>
                  ) : (
                    'Verify OTP'
                  )}
                </button>

                {/* Resend */}
                <div className="text-center">
                  {countdown > 0 ? (
                    <p className="text-xs text-slate-600">
                      Resend OTP in <span className="text-slate-400 font-mono">{countdown}s</span>
                    </p>
                  ) : (
                    <button
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="text-xs text-accent hover:text-accent/80 cursor-pointer"
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Step: Success */}
            {step === 'success' && (
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-4 animate-pulse">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p className="text-sm text-green-400 font-medium">Mobile number verified!</p>
              </div>
            )}
          </div>

          {/* Bottom strip */}
          <div className="px-6 py-3 border-t border-white/[0.04] bg-white/[0.01]">
            <p className="text-center text-[10px] text-slate-600">
              Signed in as {session?.user?.email}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
