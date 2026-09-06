'use client';

/**
 * Store settings for the current center — the `MARKETPLACE_CONFIG`
 * policy behind "Coming soon".
 *
 * Reads `GET /api/admin/shop/settings`, writes `PUT`. The two toggles
 * are the launch levers: **Store enabled** shows or hides the shop
 * everywhere, **Coming soon mode** decides whether a product page offers
 * "Notify me" or "Order on WhatsApp". A save invalidates the client-side
 * status cache so the panel's own nav reflects the change without a
 * reload.
 *
 * Nothing is editable until the stored config has been read back: the
 * form seeded with defaults and saved on top would silently overwrite a
 * center's real settings.
 */

import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, MessageCircle, Save, Store } from 'lucide-react';
import { AdminCard } from '@/components/admin/AdminCard';
import { AdminToggle } from '@/components/admin/AdminToggle';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useToast } from '@/components/ui/Toast';
import {
  MARKETPLACE_LIMITS,
  MarketplaceConfigSchema,
  toWhatsAppDigits,
  type MarketplaceConfig,
} from '@/lib/marketplace';
import { invalidateMarketplaceStatus } from '@/lib/marketplace-status';
import { formatWhatsAppDigits, inputClass, labelClass, primaryButtonClass, readApiError } from './common';
import type { ShopSettingsResponse, ShopSettingsSaveResponse } from './types';

interface Props {
  /** Fired after a successful save so the page can refresh anything that reads the config. */
  onSaved?: (config: MarketplaceConfig) => void;
}

export function MarketplaceSettingsCard({ onSaved }: Props) {
  const toast = useToast();
  // What the server has — drives the "Live status" line.
  const [saved, setSaved] = useState<ShopSettingsResponse | null>(null);
  // What the admin is editing.
  const [form, setForm] = useState<MarketplaceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/admin/shop/settings', { signal: controller.signal });
        if (!res.ok) throw new Error(await readApiError(res, "Couldn't load store settings"));
        const json = (await res.json()) as ShopSettingsResponse;
        setSaved(json);
        setForm({ ...json.config });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setLoadError(err instanceof Error ? err.message : "Couldn't load store settings");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const set = <K extends keyof MarketplaceConfig>(key: K, value: MarketplaceConfig[K]) => {
    setFormError(null);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const dirty =
    !!form &&
    !!saved &&
    (form.enabled !== saved.config.enabled ||
      form.comingSoon !== saved.config.comingSoon ||
      form.launchNote.trim() !== saved.config.launchNote ||
      form.enquiryPhone.trim() !== saved.config.enquiryPhone);

  const save = async () => {
    if (!form || !saved) return;
    setFormError(null);
    const candidate: MarketplaceConfig = {
      enabled: form.enabled,
      comingSoon: form.comingSoon,
      launchNote: form.launchNote.trim(),
      enquiryPhone: form.enquiryPhone.trim(),
    };
    const parsed = MarketplaceConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || 'Check the settings and try again');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/shop/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't save store settings"));
      const json = (await res.json()) as ShopSettingsSaveResponse;
      setSaved({ ...saved, config: json.config, enquiryPhone: json.enquiryPhone });
      setForm({ ...json.config });
      invalidateMarketplaceStatus();
      toast.success('Store settings saved');
      onSaved?.(json.config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save store settings";
      setFormError(message);
      toast.error('Save failed', message);
    } finally {
      setSaving(false);
    }
  };

  // The number the shop's WhatsApp buttons will actually open. A typed
  // number wins; blank falls back to the center's contact phone. While a
  // typed number is unusable the buttons would be hidden on the shop, so
  // say so here rather than after the save.
  const typedPhone = form?.enquiryPhone.trim() ?? '';
  const typedDigits = typedPhone ? toWhatsAppDigits(typedPhone) : null;
  // The server resolves the blank-number fallback from the center's whole
  // contact list, exactly as the shop does, so the preview is what will
  // actually be dialled.
  const fallbackDigits = saved?.fallbackEnquiryPhone ?? null;
  const resolvedDigits = typedPhone ? typedDigits : fallbackDigits;

  return (
    <AdminCard
      title="Store settings"
      subtitle="Launch state and the number customers reach on WhatsApp"
      icon={
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
          <Store className="w-4 h-4 text-accent" />
        </div>
      }
    >
      {loading ? (
        <LoadingState size="sm" message="Loading store settings…" />
      ) : loadError || !form || !saved ? (
        <ErrorState message={loadError || "Couldn't load store settings"} onRetry={retry} className="py-8" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Live status</span>
            <LiveStatus config={saved.config} />
          </div>

          <div className="-mx-3 divide-y divide-white/[0.04]">
            <AdminToggle
              enabled={form.enabled}
              onToggle={() => set('enabled', !form.enabled)}
              label="Store enabled"
              description="Show the shop in the app, on the landing page and at /shop"
              icon={Store}
              disabled={saving}
            />
            <AdminToggle
              enabled={form.comingSoon}
              onToggle={() => set('comingSoon', !form.comingSoon)}
              label="Coming soon mode"
              description="Products are browsable and customers can tap Notify me. Switch off to accept WhatsApp orders."
              icon={Clock}
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="shop-launch-note" className={labelClass}>
              Launch note
            </label>
            <input
              id="shop-launch-note"
              value={form.launchNote}
              onChange={(e) => set('launchNote', e.target.value)}
              maxLength={MARKETPLACE_LIMITS.launchNote}
              placeholder="Launching Diwali 2026 — pre-book your bat"
              className={inputClass}
              disabled={saving}
            />
            <p className="flex justify-between gap-3 text-[11px] text-slate-500 mt-1">
              <span>Shown under the shop heading. Leave blank for none.</span>
              <span className="tabular-nums shrink-0">
                {form.launchNote.length}/{MARKETPLACE_LIMITS.launchNote}
              </span>
            </p>
          </div>

          <div>
            <label htmlFor="shop-enquiry-phone" className={labelClass}>
              Enquiry WhatsApp number
            </label>
            <div className="relative">
              <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                id="shop-enquiry-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.enquiryPhone}
                onChange={(e) => set('enquiryPhone', e.target.value)}
                maxLength={20}
                placeholder={saved.centerContactPhone || '10-digit mobile number'}
                className={`${inputClass} pl-9`}
                disabled={saving}
              />
            </div>
            <p className="text-[11px] mt-1 leading-relaxed">
              {typedPhone && !typedDigits ? (
                <span className="text-red-400">
                  Not a valid Indian mobile number — enter 10 digits or leave blank.
                </span>
              ) : resolvedDigits ? (
                <span className="text-slate-500">
                  Ask / Order buttons will open WhatsApp at{' '}
                  <span className="text-slate-300 font-semibold tabular-nums">
                    {formatWhatsAppDigits(resolvedDigits)}
                  </span>
                  {!typedPhone && ' (the center contact number)'}.
                </span>
              ) : (
                <span className="text-amber-300">
                  No usable number — the shop&apos;s WhatsApp buttons will be hidden until one is set
                  here or on the center.
                </span>
              )}
            </p>
          </div>

          {formError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            {dirty && !saving && (
              <span className="text-[11px] text-amber-300/80">Unsaved changes</span>
            )}
            <button type="button" onClick={save} disabled={saving || !dirty} className={primaryButtonClass}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </AdminCard>
  );
}

/** Compact "Enabled · Coming soon" line reflecting what is saved right now. */
function LiveStatus({ config }: { config: MarketplaceConfig }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
          config.enabled
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
            : 'bg-white/[0.04] border-white/[0.1] text-slate-400'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.enabled ? 'bg-emerald-400' : 'bg-slate-500'}`}
        />
        {config.enabled ? 'Enabled' : 'Disabled'}
      </span>
      <span className="text-slate-600">·</span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
          config.comingSoon
            ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
            : 'bg-accent/10 border-accent/25 text-accent'
        }`}
      >
        {config.comingSoon ? 'Coming soon' : 'Open for orders'}
      </span>
    </div>
  );
}
