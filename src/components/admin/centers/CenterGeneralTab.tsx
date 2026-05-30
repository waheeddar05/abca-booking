'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { Field, TextInput, TextArea, SelectInput, PrimaryButton, Banner } from './centerForms';

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

/**
 * General tab for `/admin/centers/[id]` — kept to the day-to-day
 * essentials only:
 *   - Name + slug (read-only)
 *   - Booking model + Active toggle (super-admin)
 *   - A single Address textarea (postal address is stored in
 *     addressLine1; addressLine2 / city / state / pincode are kept as
 *     null on save from this form — admins who need separate fields can
 *     edit them via SQL/Studio. They were near-never used.)
 *   - Landing-page contact: phone, email, map URL (the source of truth
 *     for ContactFooter on the user app).
 *
 * Rarely-used fields trimmed from the form: shortName, displayOrder,
 * description, latitude/longitude, logoUrl, themeColor, separate city/
 * state/pincode lines. The columns still exist on the Center row; this
 * form just doesn't surface them.
 */
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
      const payload: Record<string, unknown> = {
        name: form.name,
        addressLine1: form.addressLine1 || null,
        contactPhone: form.contactPhone || null,
        contactPhones: (() => {
          const cleaned = (form.contactPhones ?? [])
            .map((c) => ({ name: (c.name ?? '').trim() || null, number: (c.number ?? '').trim() }))
            .filter((c) => c.number.length > 0);
          return cleaned.length > 0 ? cleaned : null;
        })(),
        contactEmail: form.contactEmail || null,
        mapUrl: form.mapUrl || null,
      };
      if (isSuperAdmin) {
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
    <form onSubmit={save} className="space-y-4 max-w-4xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Section title="Basics">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <Field label="Name" required>
                  <TextInput
                    required
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    className="!py-1.5 !text-xs"
                  />
                </Field>
              </div>
              {isSuperAdmin && (
                <div className="col-span-2 sm:col-span-1">
                  <Field label="Status">
                    <SelectInput
                      value={form.isActive ? 'true' : 'false'}
                      onChange={(e) => set('isActive', e.target.value === 'true')}
                      className="!py-1.5 !text-xs"
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </SelectInput>
                  </Field>
                </div>
              )}
            </div>
          </Section>

          <Section title="Address & Contact">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <Field label="Postal address">
                  <TextInput
                    value={form.addressLine1 ?? ''}
                    onChange={(e) => set('addressLine1', e.target.value || null)}
                    placeholder="Street, area, city, state, pincode"
                    className="!py-1.5 !text-xs"
                  />
                </Field>
              </div>
              <Field label="Phone">
                <TextInput
                  value={form.contactPhone ?? ''}
                  onChange={(e) => set('contactPhone', e.target.value || null)}
                  placeholder="9876543210"
                  className="!py-1.5 !text-xs"
                />
              </Field>
              <Field label="Email">
                <TextInput
                  type="email"
                  value={form.contactEmail ?? ''}
                  onChange={(e) => set('contactEmail', e.target.value || null)}
                  placeholder="hello@yourcenter.in"
                  className="!py-1.5 !text-xs"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Map URL">
                  <TextInput
                    type="url"
                    value={form.mapUrl ?? ''}
                    onChange={(e) => set('mapUrl', e.target.value || null)}
                    placeholder="https://maps.app.goo.gl/..."
                    className="!py-1.5 !text-xs"
                  />
                </Field>
              </div>
            </div>
          </Section>
        </div>

        <div>
          <Section title="Additional Contacts">
            <ContactPhonesEditor
              value={form.contactPhones ?? []}
              onChange={(v) => set('contactPhones', v)}
            />
          </Section>
        </div>
      </div>

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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs uppercase tracking-wider font-bold text-slate-300">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-slate-200">Additional contacts</h4>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
            Each row becomes a chip on the &lsquo;Ready to play?&rsquo; section. Name is optional;
            number is required. Leave the list empty to fall back to the phone above.
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
          No contacts yet. The landing page will show the phone above (or nothing if it&apos;s blank).
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
