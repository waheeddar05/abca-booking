'use client';

import { useEffect, useRef, useState } from 'react';
import { User } from 'lucide-react';
import { useCurrentUser } from '@/lib/current-user';
import { isMissingDisplayName, MAX_NAME_LENGTH, normalizeDisplayName } from '@/lib/display-name';

/**
 * Asks a signed-in user for their name when the account doesn't have one.
 *
 * Google sign-in used to supply the name; WhatsApp OTP supplies a phone
 * number and nothing else, so `/api/auth/otp/request` creates accounts with
 * `name: null`. Every surface that names a person then falls back — the
 * booking card literally renders "Unknown", which is what centre staff read
 * off the floor list — so the name has to be collected somewhere.
 *
 * It lives here, mounted once in the root layout and driven by
 * `useCurrentUser()`, rather than as a step inside `LoginModal`, because it
 * has to catch two populations with one implementation: people signing up
 * for the first time, and every account already created since the cutover
 * that has no name. A login-time step would only ever catch the first.
 *
 * Blocking on purpose: it is one field, it is asked once, and a booking with
 * no name attached is a problem for whoever is running the centre that day.
 * Nothing is dismissed or remembered client-side — the prompt disappears
 * because the profile now has a name, which is also the condition for it
 * never coming back.
 */
export function NamePrompt() {
  const { user, loading, refresh } = useCurrentUser();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const needsName = !loading && !!user && isMissingDisplayName(user.name);

  useEffect(() => {
    if (!needsName) return;
    document.body.style.overflow = 'hidden';
    const focus = setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      document.body.style.overflow = '';
      clearTimeout(focus);
    };
  }, [needsName]);

  if (!needsName) return null;

  const submit = async () => {
    if (saving) return;
    const validated = normalizeDisplayName(name);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: validated.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "We couldn't save that. Please try again.");
        return;
      }
      // Re-read the profile so every gate reading `useCurrentUser()` — this
      // prompt included — sees the new name and this modal closes itself.
      await refresh();
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
    >
      <div className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
          <User className="w-7 h-7 text-accent" />
        </div>

        <h2 id="name-prompt-title" className="text-lg font-bold text-white text-center mb-1">
          What should we call you?
        </h2>
        <p className="text-xs text-slate-400 text-center mb-5">
          Your name appears on your bookings so the team at the centre knows who&apos;s playing.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            autoComplete="name"
            enterKeyHint="done"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="Your full name"
            disabled={saving}
            aria-invalid={!!error}
            // 16px stops iOS Safari zooming the page on focus.
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-3 text-[16px] text-white placeholder:text-slate-500 outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-60"
          />

          {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full mt-4 px-4 py-3 text-sm font-bold bg-accent hover:bg-accent-light text-primary rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
