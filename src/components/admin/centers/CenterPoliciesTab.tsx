'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Save, X, Check } from 'lucide-react';
import { Field, TextInput, TextArea, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type OverrideRow = {
  id: string;
  key: string;
  value: string;
  globalValue: string | null;
  updatedAt: string;
};

const COMMON_KEYS = [
  'PRICING_CONFIG',
  'TIME_SLAB_CONFIG',
  'MACHINE_PITCH_CONFIG',
  'PAYMENT_GATEWAY_ENABLED',
  'SLOT_PAYMENT_REQUIRED',
  'PACKAGE_PAYMENT_REQUIRED',
  'CASH_PAYMENT_ENABLED',
  'WALLET_ENABLED',
  'DEFAULT_REFUND_METHOD',
  'KIT_RENTAL_CONFIG',
  'NUMBER_OF_OPERATORS',
  'BALL_TYPE_SELECTION_ENABLED',
  'PITCH_TYPE_SELECTION_ENABLED',
];

export function CenterPoliciesTab({ centerId }: { centerId: string }) {
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/policies`);
      if (res.ok) setOverrides(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [centerId]);

  const remove = async (key: string) => {
    if (!confirm(`Remove the override for "${key}"? The center will fall back to the global default.`)) return;
    const res = await fetch(`/api/admin/centers/${centerId}/policies?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res.ok) refresh();
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <Banner kind="info">
        Policy values resolve as <strong>this center → global default → hardcoded fallback</strong>.
        Add an override here only when this center should diverge from the global value.
      </Banner>

      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">{overrides.length} override(s) active</p>
        <PrimaryButton onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Add override
        </PrimaryButton>
      </div>

      {showNew && (
        <PolicyEditor
          centerId={centerId}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {overrides.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">
          No per-center overrides. This center uses every global policy as-is.
        </div>
      ) : (
        <div className="space-y-2">
          {overrides.map((o) => (
            <div key={o.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
              {editingKey === o.key ? (
                <PolicyEditor
                  centerId={centerId}
                  initial={o}
                  onCancel={() => setEditingKey(null)}
                  onSaved={() => { setEditingKey(null); refresh(); }}
                />
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <code className="text-sm font-semibold text-accent">{o.key}</code>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingKey(o.key)}
                        className="px-2 py-1 rounded-lg text-xs text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(o.key)}
                        className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                        title="Remove override"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-emerald-400 mb-1">This center</div>
                      <pre className="rounded bg-emerald-500/[0.06] border border-emerald-500/10 p-2 text-emerald-200/90 text-[11px] whitespace-pre-wrap break-all">{o.value}</pre>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Global default</div>
                      <pre className="rounded bg-white/[0.02] border border-white/[0.04] p-2 text-slate-400 text-[11px] whitespace-pre-wrap break-all">{o.globalValue ?? '(none)'}</pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyEditor({
  centerId,
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  initial?: OverrideRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(initial?.key || '');
  const [value, setValue] = useState(initial?.value || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/policies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || 'Save failed');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!initial;

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
      <Field label="Key" required help="Use one of the known keys. Custom keys are allowed but have no effect unless code reads them.">
        {isEdit ? (
          <TextInput value={key} disabled />
        ) : (
          <>
            <TextInput
              required
              list="common-policy-keys"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. PRICING_CONFIG"
            />
            <datalist id="common-policy-keys">
              {COMMON_KEYS.map((k) => <option key={k} value={k} />)}
            </datalist>
          </>
        )}
      </Field>

      <Field label="Value" help="Stored as a string. JSON values should be a single line of valid JSON.">
        <TextArea rows={4} required value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>

      {err && <Banner kind="error">{err}</Banner>}

      <div className="flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onCancel}>
          <X className="w-4 h-4" /> Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          {isEdit ? 'Save' : 'Add'}
        </PrimaryButton>
      </div>
    </form>
  );
}
