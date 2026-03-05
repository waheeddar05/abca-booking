'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

type Step = 'mobile' | 'whatsapp' | 'otp' | 'success';

const PLAYORBIT_WHATSAPP = '919049586719'; // PlayOrbit business WhatsApp number

export default function VerifyMobilePage() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();

  const [step, setStep] = useState<Step>('mobile');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if already verified
  useEffect(() => {
    if (status === 'authenticated' && (session?.user as any)?.mobileVerified) {
      router.replace('/slots');
    }
  }, [session, status, router]);

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
      <div className="min-h-screen flex items-center justify-center bg-[#060a14]">
        <div className="animate-spin w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full" />
      </div>
    );
  }

  const handleProceedToWhatsApp = () => {
    if (!isValidMobile) return;
    setError('');
    setStep('whatsapp');
  };

  const handleSendOtp = async () => {
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

  const handleVerifyOtp = async () => {
    const otpString = otp.join('');
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
      await updateSession();
      // Redirect after brief success animation
      setTimeout(() => router.replace('/slots'), 1500);
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

    // Auto-submit when all digits entered
    if (value && index === 5 && newOtp.every(d => d !== '')) {
      setTimeout(() => handleVerifyOtp(), 100);
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
    <div className="min-h-screen flex items-center justify-center bg-[#060a14] px-4">
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
                {step === 'mobile' && 'Link your WhatsApp number to continue'}
                {step === 'whatsapp' && 'Connect with PlayOrbit on WhatsApp first'}
                {step === 'otp' && `Enter the OTP sent to your WhatsApp`}
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
                    WhatsApp Mobile Number
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
                  onClick={handleProceedToWhatsApp}
                  disabled={!isValidMobile}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-green-500/90 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
                >
                  Continue
                </button>

                <p className="text-center text-[10px] text-slate-600">
                  You&apos;ll verify via WhatsApp in the next step
                </p>
              </div>
            )}

            {/* Step: WhatsApp Connect */}
            {step === 'whatsapp' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">+91 {mobileNumber}</span>
                  <button
                    onClick={() => { setStep('mobile'); setError(''); }}
                    className="text-xs text-accent hover:text-accent/80 cursor-pointer"
                  >
                    Change
                  </button>
                </div>

                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-sm">1</span>
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium">Send &quot;Hi&quot; on WhatsApp</p>
                      <p className="text-xs text-slate-500 mt-0.5">Tap the button below to open WhatsApp and send a message to PlayOrbit</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-sm">2</span>
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium">Come back &amp; get OTP</p>
                      <p className="text-xs text-slate-500 mt-0.5">After sending the message, return here to receive your verification code</p>
                    </div>
                  </div>
                </div>

                <a
                  href={`https://wa.me/${PLAYORBIT_WHATSAPP}?text=${encodeURIComponent('Hi, I want to verify my PlayOrbit account')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.97] bg-[#25D366] hover:bg-[#22c55e] text-white shadow-lg shadow-green-500/20"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Open WhatsApp
                </a>

                <button
                  onClick={handleSendOtp}
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer bg-accent/90 hover:bg-accent text-white shadow-lg shadow-accent/20 border border-accent/30"
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
                    "I've sent the message — Send OTP"
                  )}
                </button>

                <p className="text-center text-[10px] text-slate-600">
                  This step is required so WhatsApp allows us to message you
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
