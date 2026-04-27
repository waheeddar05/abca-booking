'use client';

import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
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

  const set = <K extends keyof CenterDetail>(k: K, v: CenterDetail[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/centers/${center.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          shortName: form.shortName || null,
          description: form.description || null,
          bookingModel: form.bookingModel,
          isActive: form.isActive,
          displayOrder: form.displayOrder,
          addressLine1: form.addressLine1 || null,
          addressLine2: form.addressLine2 || null,
          city: form.city || null,
          state: form.state || null,
          pincode: form.pincode || null,
          latitude: form.latitude,
          longitude: form.longitude,
          contactPhone: form.contactPhone || null,
          contactEmail: form.contactEmail || null,
          mapUrl: form.mapUrl || null,
          logoUrl: form.logoUrl || null,
          themeColor: form.themeColor || null,
        }),
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
          <Field label="Booking model" help="Affects how availability is computed.">
            <SelectInput
              value={form.bookingModel}
              onChange={(e) => set('bookingModel', e.target.value as 'MACHINE_PITCH' | 'RESOURCE_BASED')}
            >
              <option value="MACHINE_PITCH">Machine / Pitch (legacy)</option>
              <option value="RESOURCE_BASED">Resource-based (nets + staff)</option>
            </SelectInput>
          </Field>
          <Field label="Active">
            <SelectInput
              value={form.isActive ? 'true' : 'false'}
              onChange={(e) => set('isActive', e.target.value === 'true')}
            >
              <option value="true">Active — visible to users</option>
              <option value="false">Inactive — hidden</option>
            </SelectInput>
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
          <Field label="Phone">
            <TextInput value={form.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value || null)} />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={form.contactEmail ?? ''}
              onChange={(e) => set('contactEmail', e.target.value || null)}
            />
          </Field>
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
