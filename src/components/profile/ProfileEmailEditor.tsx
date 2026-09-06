'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mail, Pencil, Trash2, X } from 'lucide-react';
import { MAX_EMAIL_LENGTH, normalizeEmail } from '@/lib/email';
import { useToast } from '@/components/ui/Toast';
import { readApiError } from './profile-format';

interface ProfileEmailEditorProps {
  email: string | null;
  /** Removing the email is only offered when the account still has a mobile number. */
  hasMobile: boolean;
  /** Re-read the profile after a save so every `useCurrentUser()` reader sees it. */
  onSaved: () => Promise<void>;
}

/**
 * The account's email with an inline edit, the twin of `ProfileNameEditor`:
 * pencil → input with Save / Cancel, "Add email" when there is none, and
 * a Remove action while the account can still be reached by phone.
 * Validates with `normalizeEmail`, the same rule `PATCH /api/user/profile`
 * applies, so the form and the API can't disagree.
 */
export function ProfileEmailEditor({ email, hasMobile, onSaved }: ProfileEmailEditorProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const focus = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(focus);
  }, [editing]);

  const startEditing = () => {
    setValue(email ?? '');
    setError('');
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setError('');
  };

  const save = async (next: string | null) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: next ?? '' }),
      });
      if (!res.ok) {
        setError(await readApiError(res, "We couldn't save that. Please try again."));
        return false;
      }
      await onSaved();
      setEditing(false);
      return true;
    } catch {
      setError('Network error. Check your connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (saving) return;
    const validated = normalizeEmail(value);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    if (validated.value === null) {
      setError('Enter an email address, or use Remove to clear it.');
      return;
    }
    if (validated.value === (email ?? '').toLowerCase()) {
      setEditing(false);
      return;
    }
    if (await save(validated.value)) {
      toast.success('Email updated', validated.value);
    }
  };

  const remove = async () => {
    if (saving || !hasMobile) return;
    if (await save(null)) {
      toast.info('Email removed', 'You can add one again any time.');
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm min-w-0">
        <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        {email ? (
          <span className="text-slate-300 truncate">{email}</span>
        ) : (
          <span className="text-slate-500">No email added</span>
        )}
        <button
          type="button"
          onClick={startEditing}
          aria-label={email ? 'Edit email' : 'Add email'}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-accent-light transition-colors cursor-pointer shrink-0"
        >
          <Pencil className="w-3 h-3" aria-hidden="true" />
          {email ? 'Edit' : 'Add email'}
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          maxLength={MAX_EMAIL_LENGTH}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="you@example.com"
          aria-label="Email address"
          aria-invalid={!!error}
          disabled={saving}
          className="flex-1 min-w-0 bg-slate-900/60 border border-white/[0.1] text-white rounded-lg px-3 py-1.5 text-[16px] sm:text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] disabled:opacity-50 placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          aria-label="Save email"
          className="p-1.5 rounded-lg bg-accent text-primary hover:bg-accent-light transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="p-1.5 rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 pl-5.5">
        {error ? (
          <p className="text-[11px] text-red-400" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">Used for receipts and store enquiries.</p>
        )}
        {email && hasMobile && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={saving}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400/80 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
