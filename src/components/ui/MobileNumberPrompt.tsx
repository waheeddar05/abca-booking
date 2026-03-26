'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, X } from 'lucide-react';

interface MobileNumberPromptProps {
  open: boolean;
  onSubmit: (mobileNumber: string) => void;
  onDismiss: () => void;
}

export function MobileNumberPrompt({ open, onSubmit, onDismiss }: MobileNumberPromptProps) {
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMobile('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const validateMobile = (num: string) => {
    // Indian mobile number: 10 digits starting with 6-9
    const cleaned = num.replace(/\D/g, '');
    return /^[6-9]\d{9}$/.test(cleaned);
  };

  const handleSubmit = async () => {
    const cleaned = mobile.replace(/\D/g, '');
    if (!validateMobile(cleaned)) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    // Go directly to verify-mobile page with the number pre-filled
    // The verify page will save + verify in one flow
    onSubmit(cleaned);
    router.push(`/verify-mobile?mobile=${cleaned}`);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
          <Phone className="w-7 h-7 text-accent" />
        </div>

        <h2 className="text-lg font-bold text-white text-center mb-1">Verify Your Mobile</h2>
        <p className="text-xs text-slate-400 text-center mb-5">
          Verify your number to receive booking confirmations on WhatsApp.
        </p>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 font-medium">+91</span>
            <input
              ref={inputRef}
              type="tel"
              placeholder="Enter 10-digit mobile number"
              value={mobile}
              onChange={(e) => {
                setMobile(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              maxLength={10}
              className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 mt-1.5">{error}</p>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !mobile.trim()}
          className="w-full px-4 py-3 text-sm font-bold bg-accent hover:bg-accent-light text-primary rounded-xl transition-colors cursor-pointer disabled:opacity-50 mb-3"
        >
          Verify Mobile Number
        </button>

        <button
          onClick={onDismiss}
          className="w-full px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          I'll add it later
        </button>
      </div>
    </div>
  );
}
