'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * WhatsApp login — the only way into PlayOrbit.
 *
 * Two steps against the OTP endpoints:
 *   1. `POST /api/auth/otp/request` — sends a code to the number
 *      (WhatsApp first, SMS as the backstop).
 *   2. `POST /api/auth/otp/verify`  — checks it and sets the session cookie.
 *
 * On success we hard-navigate rather than router.push: the session lives in
 * an httpOnly cookie that every provider reads on mount, so a full load is
 * what guarantees the whole tree sees the signed-in user.
 */

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Same-origin path to load after a successful sign-in. Defaults to the
   * booking screen; the landing page passes a validated `?next=` here so
   * a visitor sent to sign in from the shop lands back on the product.
   */
  redirectTo?: string;
}

type Step = 'mobile' | 'otp';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function LoginModal({ isOpen, onClose, redirectTo = '/slots' }: LoginModalProps) {
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
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

  // Reset to a clean form each time the modal is opened, so a previous
  // failed attempt isn't still on screen.
  useEffect(() => {
    if (!isOpen) return;
    setStep('mobile');
    setOtp('');
    setError('');
    setNotice('');
    setLoading(false);
  }, [isOpen]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, step]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, handleClose]);

  const isValidMobile = /^[6-9]\d{9}$/.test(mobile);

  const sendCode = async () => {
    if (!isValidMobile || loading) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber: mobile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "We couldn't send your code. Please try again.");
        return;
      }
      setStep('otp');
      setOtp('');
      setResendIn(RESEND_SECONDS);
      // A deliverability caveat is advisory — the code may still arrive.
      if (data?.warning) setNotice(data.warning);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (otp.length < OTP_LENGTH || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobileNumber: mobile, otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'That code is not right. Please try again.');
        setLoading(false);
        return;
      }
      // Full load so every provider picks up the new session cookie.
      window.location.href = redirectTo;
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

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
      <div
        className={`absolute top-[12%] right-[8%] transition-all duration-700 delay-200 ${
          visible ? 'opacity-[0.06] scale-100' : 'opacity-0 scale-75'
        }`}
      >
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
                {step === 'mobile' ? 'SIGN IN TO PLAY' : 'ENTER YOUR CODE'}
              </h2>
              <p className="text-[11px] md:text-xs text-slate-500 mt-0.5">
                {step === 'mobile' ? (
                  'We’ll send a code to your WhatsApp'
                ) : (
                  <>
                    Sent to <span className="font-semibold text-accent">+91 {mobile}</span>
                  </>
                )}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                {error}
              </div>
            )}

            {/* Deliverability caveat — advisory, the code may still arrive */}
            {notice && !error && (
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg text-[11px] leading-relaxed">
                {notice}
              </div>
            )}

            {step === 'mobile' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendCode();
                }}
                className="space-y-3"
              >
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center px-3 rounded-xl bg-white/[0.04] border border-white/[0.1] text-sm font-semibold text-slate-400">
                    +91
                  </span>
                  <input
                    ref={inputRef}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    required
                    maxLength={10}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    disabled={loading}
                    // 16px stops iOS Safari zooming the page on focus.
                    className="flex-1 min-w-0 px-3 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-[16px] text-white outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/10 placeholder:text-slate-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !isValidMobile}
                  className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl font-bold text-sm text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-[#25D366]/[0.14] hover:bg-[#25D366]/[0.22] border border-[#25D366]/30 hover:border-[#25D366]/50"
                >
                  <svg className="w-[18px] h-[18px] flex-shrink-0" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  <span>{loading ? 'Sending code…' : 'Continue with WhatsApp'}</span>
                </button>

                <p className="text-center text-[10px] text-slate-600 leading-relaxed">
                  We send a one-time code to your WhatsApp. If WhatsApp
                  can&apos;t reach you, we&apos;ll text it instead.
                </p>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  verifyCode();
                }}
                className="space-y-3"
              >
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={OTP_LENGTH}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                  placeholder="------"
                  disabled={loading}
                  className="w-full px-4 py-3.5 bg-white/[0.04] border-2 border-white/[0.1] rounded-xl text-center text-2xl tracking-[0.4em] font-mono text-white outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/10 placeholder:text-slate-600"
                />

                <button
                  type="submit"
                  disabled={loading || otp.length < OTP_LENGTH}
                  className="w-full py-3 bg-accent hover:bg-accent-light text-primary rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </button>

                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('mobile');
                      setError('');
                      setNotice('');
                    }}
                    disabled={loading}
                    className="text-[11px] text-slate-400 hover:text-accent transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Change number
                  </button>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={loading || resendIn > 0}
                    className="text-[11px] text-slate-400 hover:text-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </form>
            )}
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
