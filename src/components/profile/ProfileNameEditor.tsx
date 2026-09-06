'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { MAX_NAME_LENGTH, normalizeDisplayName } from '@/lib/display-name';
import { useToast } from '@/components/ui/Toast';
import { readApiError } from './profile-format';

interface ProfileNameEditorProps {
  name: string | null;
  /**
   * Re-read the profile after a save so every `useCurrentUser()` reader
   * (navbar, booking form, this card) sees the new name at once.
   */
  onSaved: () => Promise<void>;
}

/**
 * The account's display name with an inline edit: pencil → input with
 * Save / Cancel. Validates with `normalizeDisplayName`, the same rule the
 * API applies, so the form and `PATCH /api/user/profile` can't disagree.
 */
export function ProfileNameEditor({ name, onSaved }: ProfileNameEditorProps) {
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
    setValue(name ?? '');
    setError('');
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setError('');
  };

  const submit = async () => {
    if (saving) return;
    const validated = normalizeDisplayName(value);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    // Nothing changed — close without a round trip.
    if (validated.value === (name ?? '').trim().replace(/\s+/g, ' ')) {
      setEditing(false);
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
      if (!res.ok) {
        setError(await readApiError(res, "We couldn't save that. Please try again."));
        return;
      }
      await onSaved();
      setEditing(false);
      toast.success('Name updated', `You’ll appear as ${validated.value} on your bookings.`);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <p
          className={`text-base font-bold truncate ${name ? 'text-white' : 'text-slate-500 italic font-medium'}`}
        >
          {name || 'Add your name'}
        </p>
        <button
          type="button"
          onClick={startEditing}
          aria-label="Edit name"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="min-w-0"
    >
      <label htmlFor="profile-name" className="sr-only">
        Your name
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="profile-name"
          ref={inputRef}
          type="text"
          autoComplete="name"
          enterKeyHint="done"
          maxLength={MAX_NAME_LENGTH}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          aria-invalid={!!error}
          placeholder="Your full name"
          // 16px stops iOS Safari zooming the page on focus.
          className="flex-1 min-w-0 bg-slate-900/60 border border-white/[0.1] text-white rounded-lg px-3 py-2 text-[16px] sm:text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          aria-label="Save name"
          className="w-9 h-9 rounded-lg bg-accent hover:bg-accent-light text-primary flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="w-9 h-9 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-400 mt-1.5">
          {error}
        </p>
      )}
    </form>
  );
}
