'use client';

/**
 * Create / edit dialog for a delivery address.
 *
 * One component serves both: pass `address` to edit it, null to add one.
 * The form validates with `AddressInputSchema` — the very schema the API
 * runs — before it submits, so the first problem is shown under the form
 * (and the offending field outlined) without a round trip, and the two
 * ends can never disagree on what an address is. A server 400 is shown
 * in the same place.
 *
 * Layout follows `ConfirmDialog`: pinned header and action row, only the
 * fields scroll, `dvh` so the phone's browser chrome is excluded. Every
 * write returns the full refreshed list, which the parent swaps in.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  ADDRESS_LIMITS,
  AddressInputSchema,
  INDIAN_STATES,
  type UserAddressView,
} from '@/lib/addresses';
import { isSignedOutResponse, readApiError } from './profile-format';

const inputClass =
  'w-full bg-slate-900/60 border text-white rounded-lg px-3 py-2 text-[16px] sm:text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark] disabled:opacity-50 placeholder:text-slate-600';
const labelClass = 'block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-0.5';

const DEFAULT_STATE = 'Maharashtra';
const QUICK_LABELS = ['Home', 'Work', 'Other'] as const;

interface FormState {
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

type TextField = Exclude<keyof FormState, 'isDefault'>;

const TEXT_FIELDS: ReadonlyArray<TextField> = [
  'label',
  'fullName',
  'phone',
  'line1',
  'line2',
  'landmark',
  'city',
  'state',
  'pincode',
];

function isTextField(value: unknown): value is TextField {
  return typeof value === 'string' && (TEXT_FIELDS as ReadonlyArray<string>).includes(value);
}

export interface AddressPrefill {
  name: string | null;
  mobile: string | null;
}

function blankForm(prefill: AddressPrefill, isFirst: boolean): FormState {
  return {
    label: '',
    fullName: prefill.name?.trim() ?? '',
    phone: prefill.mobile ?? '',
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    state: DEFAULT_STATE,
    pincode: '',
    isDefault: isFirst,
  };
}

function formFromAddress(address: UserAddressView): FormState {
  return {
    label: address.label ?? '',
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? '',
    landmark: address.landmark ?? '',
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

export interface AddressSaveResult {
  address: UserAddressView;
  addresses: UserAddressView[];
}

interface AddressFormDialogProps {
  /** Address being edited, or null to add a new one. */
  address: UserAddressView | null;
  /** Account name and mobile, prefilled on a new address. */
  prefill: AddressPrefill;
  /** No addresses saved yet — the new one becomes the default whatever the box says. */
  isFirst: boolean;
  onClose: () => void;
  onSaved: (result: AddressSaveResult) => void;
  /** The API answered "signed out" mid-edit; the page swaps to its sign-in state. */
  onSignedOut: () => void;
}

export function AddressFormDialog({
  address,
  prefill,
  isFirst,
  onClose,
  onSaved,
  onSignedOut,
}: AddressFormDialogProps) {
  const [form, setForm] = useState<FormState>(() =>
    address ? formFromAddress(address) : blankForm(prefill, isFirst),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<TextField | null>(null);
  const fieldRefs = useRef<Partial<Record<TextField, HTMLInputElement | HTMLSelectElement | null>>>(
    {},
  );

  const editingDefault = !!address?.isDefault;
  // The box is decided for the user in two cases: the current default
  // can't be unset (only moved), and the first address is always default.
  const defaultLocked = editingDefault || (!address && isFirst);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (error) {
      setError(null);
      setErrorField(null);
    }
  };

  const close = useCallback(() => {
    if (saving) return;
    onClose();
  }, [saving, onClose]);

  // Body scroll lock while open, focus back to the opener on unmount —
  // the ConfirmDialog contract. Mount-only on purpose: `close` changes
  // identity when `saving` flips, and a cleanup that ran then would hand
  // focus to the button behind the modal mid-save.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);

  // ESC to close.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  // Land the cursor on the first required field that's still empty — on a
  // new address with name and phone prefilled that's the street line.
  useEffect(() => {
    const order: TextField[] = ['fullName', 'phone', 'line1', 'city', 'pincode'];
    const focus = setTimeout(() => {
      const target = order.find((f) => !fieldRefs.current[f]?.value) ?? 'fullName';
      fieldRefs.current[target]?.focus();
    }, 60);
    return () => clearTimeout(focus);
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setErrorField(null);

    const parsed = AddressInputSchema.safeParse({
      label: form.label,
      fullName: form.fullName,
      phone: form.phone,
      line1: form.line1,
      line2: form.line2,
      landmark: form.landmark,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      // The server forces these two cases anyway; send what it will do so
      // the response can't surprise the form.
      isDefault: defaultLocked ? true : form.isDefault,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue && isTextField(issue.path[0]) ? issue.path[0] : null;
      setError(issue?.message || 'Check the address and try again.');
      setErrorField(field);
      if (field) fieldRefs.current[field]?.focus();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(address ? `/api/user/addresses/${address.id}` : '/api/user/addresses', {
        method: address ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (isSignedOutResponse(res)) {
        onSignedOut();
        return;
      }
      if (!res.ok) {
        setError(await readApiError(res, 'Could not save the address. Please try again.'));
        return;
      }
      const data = (await res.json()) as AddressSaveResult;
      onSaved(data);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = (field: TextField) =>
    `${inputClass} ${errorField === field ? 'border-red-500/60' : 'border-white/[0.1]'}`;

  const bind = (field: TextField) => ({
    id: `address-${field}`,
    name: field,
    value: form[field],
    disabled: saving,
    'aria-invalid': errorField === field,
    className: fieldClass(field),
    ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
      fieldRefs.current[field] = el;
    },
  });

  // An address saved elsewhere with a state that isn't in the picker
  // still has to show its value rather than fall blank.
  const stateOptions: ReadonlyArray<string> = (INDIAN_STATES as ReadonlyArray<string>).includes(
    form.state,
  )
    ? INDIAN_STATES
    : [form.state, ...INDIAN_STATES];

  const activeLabel = form.label.trim().toLowerCase();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="address-dialog-title"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        className="bg-[#0f1d2f] border border-white/[0.12] rounded-2xl w-full max-w-md shadow-2xl animate-slide-up flex flex-col max-h-[calc(100dvh-2rem)]"
      >
        {/* Header — pinned */}
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 id="address-dialog-title" className="text-base font-bold text-white">
              {address ? 'Edit address' : 'Add address'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {address ? 'Update where your gear ships to.' : 'Where should your gear ship to?'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="p-1.5 -mt-1 -mr-1.5 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — the only scrollable region */}
        <div className="px-5 pb-1 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4">
          <div>
            <label htmlFor="address-label" className={labelClass}>
              Label <span className="normal-case font-medium text-slate-500">(optional)</span>
            </label>
            <div className="flex items-center gap-1.5 mb-2">
              {QUICK_LABELS.map((quick) => {
                const selected = activeLabel === quick.toLowerCase();
                return (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => set('label', quick)}
                    disabled={saving}
                    aria-pressed={selected}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                      selected
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-white/[0.04] border-white/[0.1] text-slate-300 hover:bg-white/[0.08]'
                    }`}
                  >
                    {quick}
                  </button>
                );
              })}
            </div>
            <input
              {...bind('label')}
              type="text"
              maxLength={ADDRESS_LIMITS.label}
              placeholder="e.g. Home, Parents’ place"
              onChange={(e) => set('label', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="address-fullName" className={labelClass}>
              Full name
            </label>
            <input
              {...bind('fullName')}
              type="text"
              autoComplete="name"
              maxLength={ADDRESS_LIMITS.fullName}
              placeholder="Who receives the delivery"
              onChange={(e) => set('fullName', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="address-phone" className={labelClass}>
              Phone
            </label>
            <input
              {...bind('phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={16}
              placeholder="10-digit mobile number"
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="address-line1" className={labelClass}>
              Address line 1
            </label>
            <input
              {...bind('line1')}
              type="text"
              autoComplete="address-line1"
              maxLength={ADDRESS_LIMITS.line1}
              placeholder="House / flat, building, street"
              onChange={(e) => set('line1', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="address-line2" className={labelClass}>
              Line 2 <span className="normal-case font-medium text-slate-500">(optional)</span>
            </label>
            <input
              {...bind('line2')}
              type="text"
              autoComplete="address-line2"
              maxLength={ADDRESS_LIMITS.line2}
              placeholder="Area, locality"
              onChange={(e) => set('line2', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="address-landmark" className={labelClass}>
              Landmark <span className="normal-case font-medium text-slate-500">(optional)</span>
            </label>
            <input
              {...bind('landmark')}
              type="text"
              maxLength={ADDRESS_LIMITS.landmark}
              placeholder="Near…"
              onChange={(e) => set('landmark', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="address-city" className={labelClass}>
                City
              </label>
              <input
                {...bind('city')}
                type="text"
                autoComplete="address-level2"
                maxLength={ADDRESS_LIMITS.city}
                placeholder="City"
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="address-pincode" className={labelClass}>
                PIN code
              </label>
              <input
                {...bind('pincode')}
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="6 digits"
                onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
          </div>

          <div>
            <label htmlFor="address-state" className={labelClass}>
              State
            </label>
            <select
              {...bind('state')}
              autoComplete="address-level1"
              onChange={(e) => set('state', e.target.value)}
            >
              {stateOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <label
            htmlFor="address-isDefault"
            className={`flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 ${
              defaultLocked ? 'cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <input
              id="address-isDefault"
              name="isDefault"
              type="checkbox"
              checked={defaultLocked ? true : form.isDefault}
              disabled={defaultLocked || saving}
              onChange={(e) => set('isDefault', e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0 rounded accent-accent cursor-pointer disabled:cursor-not-allowed"
            />
            <span className="min-w-0">
              <span className="block text-sm text-white">Make this my default address</span>
              <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">
                {editingDefault
                  ? 'This is your default. To change it, set another address as the default.'
                  : !address && isFirst
                    ? 'Your first address becomes the default automatically.'
                    : 'The default goes into your WhatsApp order message.'}
              </span>
            </span>
          </label>
        </div>

        {/* Error + actions — pinned, so the message is never scrolled out of view */}
        <div className="px-5 pt-3 pb-5 flex-shrink-0 space-y-3">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300"
            >
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="flex-1 min-w-0 px-3 py-2.5 text-sm font-medium text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-w-0 px-3 py-2.5 text-sm font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 bg-accent hover:bg-accent-light text-primary"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </span>
              ) : address ? (
                'Save changes'
              ) : (
                'Save address'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
