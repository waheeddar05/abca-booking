'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Field, TextInput, TextArea, NumberInput, SelectInput, PrimaryButton, Banner } from './centerForms';

export type CenterDetail = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  description: string | null;
  bookingModel: 'MACHINE_PITCH' | 'RESOURCE_BASED';
  isActive: boolean;
  displayOrder: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  /** Multi-contact list rendered on the landing-page 'Ready to play'
   *  strip. Each entry: { name?: string | null, number: string }.
   *  When null/empty, the landing page falls back to a one-entry list
   *  synthesised from contactPhone. */
  contactPhones: Array<{ name: string | null; number: string }> | null;
  contactEmail: string | null;
  mapUrl: string | null;
  logoUrl: string | null;
  themeColor: string | null;
};

export function CenterGeneralTab({
  center,
  onSaved,
}: {
  center: CenterDetail;
  onSaved: (c: CenterDetail) => void;
}) {
  const [form, setForm] = useState<CenterDetail>(center);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin === true;

  const set = <K extends keyof CenterDetail>(k: K, v: CenterDetail[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      // `bookingModel` and `isActive` are super-admin-only on the API.
      // Strip them when the caller isn't a super admin so the save
      // doesn't 403 on those fields.
      const payload: Record<string, unknown> = {
        name: form.name,
        shortName: form.shortName || null,
        description: form.description || null,
        displayOrder: form.displayOrder,
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        state: form.state || null,
        pincode: form.pincode || null,
        latitude: form.latitude,
        longitude: form.longitude,
        contactPhone: form.contactPhone || null,
        // Strip blank rows so a half-filled "Add contact" doesn't
        // overwrite the saved list with an empty-number entry. When
        // every row is blank we send null to fall back to contactPhone.
        contactPhones: (() => {
          const cleaned = (form.contactPhones ?? [])
            .map((c) => ({ name: (c.name ?? '').trim() || null, number: (c.number ?? '').trim() }))
            .filter((c) => c.number.length > 0);
          return cleaned.length > 0 ? cleaned : null;
        })(),
        contactEmail: form.contactEmail || null,
        mapUrl: form.mapUrl || null,
        logoUrl: form.logoUrl || null,
        themeColor: form.themeColor || null,
      };
      if (isSuperAdmin) {
        payload.bookingModel = form.bookingModel;
        payload.isActive = form.isActive;
      }
      const res = await fetch(`/api/admin/centers/${center.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: 'error', text: data?.error || 'Save failed' });
        return;
      }
      setMsg({ kind: 'success', text: 'Saved.' });
      onSaved(data);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Section title="Basics">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" required>
            <TextInput
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Slug (read-only)">
            <TextInput value={form.slug} disabled />
          </Field>
          <Field label="Short name">
            <TextInput
              value={form.shortName ?? ''}
              onChange={(e) => set('shortName', e.target.value || null)}
            />
          </Field>
          <Field label="Display order">
            <NumberInput
              value={form.displayOrder}
              onChange={(e) => set('displayOrder', Number(e.target.value))}
            />
          </Field>
          {/* Booking model + Active stay super-admin-only: flipping
              either of them breaks every running booking flow. Center
              admins see them as read-only summaries instead. */}
          <Field label="Booking model" help="Affects how availability is computed.">
            {isSuperAdmin ? (
              <SelectInput
                value={form.bookingModel}
                onChange={(e) => set('bookingModel', e.target.value as 'MACHINE_PITCH' | 'RESOURCE_BASED')}
              >
                <option value="MACHINE_PITCH">Machine / Pitch (legacy)</option>
                <option value="RESOURCE_BASED">Resource-based (nets + staff)</option>
              </SelectInput>
            ) : (
              <TextInput
                disabled
                value={form.bookingModel === 'RESOURCE_BASED' ? 'Resource-based (nets + staff)' : 'Machine / Pitch (legacy)'}
              />
            )}
          </Field>
          <Field label="Active">
            {isSuperAdmin ? (
              <SelectInput
                value={form.isActive ? 'true' : 'false'}
                onChange={(e) => set('isActive', e.target.value === 'true')}
              >
                <option value="true">Active — visible to users</option>
                <option value="false">Inactive — hidden</option>
              </SelectInput>
            ) : (
              <TextInput disabled value={form.isActive ? 'Active — visible to users' : 'Inactive — hidden'} />
            )}
          </Field>
        </div>
        <Field label="Description">
          <TextArea
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value || null)}
          />
        </Field>
      </Section>

      <Section title="Location">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Address line 1">
            <TextInput value={form.addressLine1 ?? ''} onChange={(e) => set('addressLine1', e.target.value || null)} />
          </Field>
          <Field label="Address line 2">
            <TextInput value={form.addressLine2 ?? ''} onChange={(e) => set('addressLine2', e.target.value || null)} />
          </Field>
          <Field label="City">
            <TextInput value={form.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
          </Field>
          <Field label="State">
            <TextInput value={form.state ?? ''} onChange={(e) => set('state', e.target.value || null)} />
          </Field>
          <Field label="Pincode">
            <TextInput value={form.pincode ?? ''} onChange={(e) => set('pincode', e.target.value || null)} />
          </Field>
          <Field label="Map URL" help="A Google Maps / OpenStreetMap link to the center.">
            <TextInput
              type="url"
              value={form.mapUrl ?? ''}
              onChange={(e) => set('mapUrl', e.target.value || null)}
            />
          </Field>
          <Field label="Latitude" help="Used for nearest-center auto-suggest.">
            <NumberInput
              step="any"
              value={form.latitude ?? ''}
              onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Longitude">
            <NumberInput
              step="any"
              value={form.longitude ?? ''}
              onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Primary phone">
            <TextInput
              value={form.contactPhone ?? ''}
              onChange={(e) => set('contactPhone', e.target.value || null)}
              placeholder="Used as fallback when no contacts below"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={form.contactEmail ?? ''}
              onChange={(e) => set('contactEmail', e.target.value || null)}
            />
          </Field>
        </div>

        {/* Multi-contact strip. Each (name, number) pair becomes a chip
            on the landing page's 'Ready to play' section. Empty rows
            are stripped at save time so leaving a half-filled "Add"
            in place doesn't poison the list. When no rows exist the
            landing page falls back to the primary phone above. */}
        <div className="mt-4">
          <ContactPhonesEditor
            value={form.contactPhones ?? []}
            onChange={(v) => set('contactPhones', v)}
          />
        </div>
      </Section>

      <Section title="Branding">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Logo URL">
            <TextInput
              type="url"
              value={form.logoUrl ?? ''}
              onChange={(e) => set('logoUrl', e.target.value || null)}
            />
          </Field>
          <Field label="Theme color" help="Hex code, e.g. #38bdf8.">
            <TextInput
              value={form.themeColor ?? ''}
              onChange={(e) => set('themeColor', e.target.value || null)}
            />
          </Field>
        </div>
      </Section>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <div className="flex justify-end pt-1">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save changes
        </PrimaryButton>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider font-bold text-slate-300">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Inline editor for the center's multi-contact list. Each row carries
 * an optional name + a required phone number. Empty rows are tolerated
 * here (so the admin can click "Add contact" and start typing) and
 * filtered out on save in the parent. Rendered as a stacked list on
 * mobile and a two-column grid on wider screens to keep the form
 * compact even with many contacts.
 */
function ContactPhonesEditor({
  value,
  onChange,
}: {
  value: Array<{ name: string | null; number: string }>;
  onChange: (next: Array<{ name: string | null; number: string }>) => void;
}) {
  const update = (i: number, patch: Partial<{ name: string | null; number: string }>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const add = () => onChange([...value, { name: null, number: '' }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-semibold text-slate-200">Landing-page contacts</h4>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
            Each row becomes a chip on the &lsquo;Ready to play?&rsquo; section. Name is optional;
            number is required. Leave the whole list empty to fall back to the primary phone above.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/15 border border-accent/30 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add contact
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic py-2">
          No contacts yet. The landing page will show the primary phone (or nothing if both are blank).
        </p>
      ) : (
        <div className="space-y-1.5">
          {value.map((c, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center bg-white/[0.02] border border-white/[0.06] rounded-lg p-2"
            >
              <TextInput
                value={c.name ?? ''}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Name (optional, e.g. Pratyush)"
              />
              <TextInput
                value={c.number ?? ''}
                onChange={(e) => update(i, { number: e.target.value })}
                placeholder="Phone, e.g. 9876543210"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                title="Remove contact"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
