'use client';

import { useState } from 'react';
import { Save, Loader2, ShieldAlert } from 'lucide-react';
import { Field, TextInput, PrimaryButton, Banner } from './centerForms';
import type { CenterDetail } from './CenterGeneralTab';

type Detail = CenterDetail & {
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
};

/**
 * The secret values are returned masked from the API (`••••<last4>`); we
 * preserve the masked string in the form unless the user types something
 * new. Sending the masked value back is a no-op clear, so we filter
 * those out before PATCH.
 */
const MASK_PREFIX = '••••';

export function CenterPaymentTab({
  center,
  onSaved,
}: {
  center: Detail;
  onSaved: (c: Detail) => void;
}) {
  const [keyId, setKeyId] = useState(center.razorpayKeyId ?? '');
  const [keySecret, setKeySecret] = useState(center.razorpayKeySecret ?? '');
  const [webhookSecret, setWebhookSecret] = useState(center.razorpayWebhookSecret ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const isMasked = (s: string) => s.startsWith(MASK_PREFIX);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { razorpayKeyId: keyId || null };
      // Only send secrets that the user actually changed (i.e. unmasked them).
      if (!isMasked(keySecret)) body.razorpayKeySecret = keySecret || null;
      if (!isMasked(webhookSecret)) body.razorpayWebhookSecret = webhookSecret || null;

      const res = await fetch(`/api/admin/centers/${center.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: 'error', text: data?.error || 'Save failed' });
        return;
      }
      setMsg({ kind: 'success', text: 'Saved.' });
      onSaved(data);
      // Re-mask after save
      if (data.razorpayKeySecret) setKeySecret(data.razorpayKeySecret);
      if (data.razorpayWebhookSecret) setWebhookSecret(data.razorpayWebhookSecret);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Banner kind="info">
        Per-center Razorpay credentials. When set, payments at this center route to this account.
        When blank, the platform falls back to <code>RAZORPAY_KEY_ID</code> / <code>RAZORPAY_KEY_SECRET</code> from env.
      </Banner>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2 text-amber-200/90 text-xs">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          The key secret and webhook secret are stored in plaintext in the database. Treat
          access to <strong>/admin/centers/*</strong> as equivalent to access to your Razorpay account.
          Encryption-at-rest will land in a follow-up before this UI is exposed to non-super-admin staff.
        </div>
      </div>

      <Field label="Razorpay Key ID" help="Public-ish identifier (rzp_live_… / rzp_test_…)">
        <TextInput value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_…" />
      </Field>

      <Field label="Razorpay Key Secret" help="Stored encrypted at rest in a future iteration. For now: plaintext.">
        <TextInput
          type="text"
          value={keySecret}
          onChange={(e) => setKeySecret(e.target.value)}
          onFocus={() => isMasked(keySecret) && setKeySecret('')}
          placeholder="(unchanged)"
        />
      </Field>

      <Field label="Razorpay Webhook Secret" help="Used to verify incoming webhook signatures.">
        <TextInput
          type="text"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          onFocus={() => isMasked(webhookSecret) && setWebhookSecret('')}
          placeholder="(unchanged)"
        />
      </Field>

      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

      <div className="flex justify-end">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save payment config
        </PrimaryButton>
      </div>
    </form>
  );
}
