'use client';

/**
 * Create / edit dialog for a marketplace product.
 *
 * One form serves both: `product` null creates through `POST`, otherwise
 * the row is replaced through `PATCH` with the **complete** input (the
 * API never takes a partial). Text fields are kept as strings until
 * submit, when they are parsed and run through `ProductInputSchema` —
 * the same schema the API applies — so the first problem is shown inline
 * before a request is made, and a server 400 reads the same way.
 *
 * Photos are not part of this form: they are uploaded one at a time via
 * `ProductImagesManager`, which the page opens right after a create.
 */

import { useId, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { AdminToggle } from '@/components/admin/AdminToggle';
import { useToast } from '@/components/ui/Toast';
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_IDS,
  MARKETPLACE_LIMITS,
  ProductInputSchema,
  isMarketplaceCategory,
  type MarketplaceCategoryId,
  type MarketplaceProductAdminView,
  type ProductSpec,
} from '@/lib/marketplace';
import { inputClass, labelClass, primaryButtonClass, readApiError, secondaryButtonClass } from './common';
import { ShopDialog } from './ShopDialog';

interface FormState {
  name: string;
  category: MarketplaceCategoryId;
  brand: string;
  sku: string;
  price: string;
  mrp: string;
  stockQty: string;
  inStock: boolean;
  isActive: boolean;
  isFeatured: boolean;
  displayOrder: string;
  sizes: string[];
  specs: ProductSpec[];
  description: string;
}

function blankForm(): FormState {
  return {
    name: '',
    category: MARKETPLACE_CATEGORY_IDS[0],
    brand: '',
    sku: '',
    price: '',
    mrp: '',
    stockQty: '',
    inStock: true,
    isActive: false,
    isFeatured: false,
    displayOrder: '0',
    sizes: [],
    specs: [],
    description: '',
  };
}

function formFromProduct(p: MarketplaceProductAdminView): FormState {
  return {
    name: p.name,
    category: isMarketplaceCategory(p.category) ? p.category : MARKETPLACE_CATEGORY_IDS[0],
    brand: p.brand ?? '',
    sku: p.sku ?? '',
    price: String(p.price),
    mrp: p.mrp == null ? '' : String(p.mrp),
    stockQty: p.stockQty == null ? '' : String(p.stockQty),
    inStock: p.inStock,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    displayOrder: String(p.displayOrder),
    sizes: [...p.sizes],
    specs: p.specs.map((s) => ({ label: s.label, value: s.value })),
    description: p.description ?? '',
  };
}

/**
 * A numeric text field: blank is "not given" (null), anything that isn't
 * a finite number is flagged so it can't silently become null and slip
 * past the schema as "optional".
 */
function parseNumberField(raw: string): { value: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, invalid: false };
  const n = Number(trimmed);
  return Number.isFinite(n) ? { value: n, invalid: false } : { value: null, invalid: true };
}

interface Props {
  /** Product being edited, or null to create a new one. */
  product: MarketplaceProductAdminView | null;
  onClose: () => void;
  onSaved: (product: MarketplaceProductAdminView, created: boolean) => void;
}

export function ProductFormDialog({ product, onClose, onSaved }: Props) {
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => (product ? formFromProduct(product) : blankForm()));
  const [sizeDraft, setSizeDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  // ─── Sizes ──────────────────────────────────────────────────────
  // Called from event handlers only, so `form.sizes` is current here.
  const addSizes = (raw: string) => {
    setSizeDraft('');
    const incoming = raw
      .split(',')
      .map((s) => s.trim().slice(0, MARKETPLACE_LIMITS.sizeLabel))
      .filter(Boolean);
    if (incoming.length === 0) return;
    const next = [...form.sizes];
    let overflow = false;
    for (const s of incoming) {
      if (next.length >= MARKETPLACE_LIMITS.sizes) {
        overflow = true;
        break;
      }
      if (next.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
      next.push(s);
    }
    setForm((f) => ({ ...f, sizes: next }));
    if (overflow) setError(`At most ${MARKETPLACE_LIMITS.sizes} sizes`);
  };

  const removeSize = (index: number) =>
    setForm((f) => ({ ...f, sizes: f.sizes.filter((_, i) => i !== index) }));

  const sizesFull = form.sizes.length >= MARKETPLACE_LIMITS.sizes;

  // ─── Specs ──────────────────────────────────────────────────────
  const addSpec = () =>
    setForm((f) =>
      f.specs.length >= MARKETPLACE_LIMITS.specs
        ? f
        : { ...f, specs: [...f.specs, { label: '', value: '' }] },
    );
  const updateSpec = (index: number, key: keyof ProductSpec, value: string) =>
    setForm((f) => ({
      ...f,
      specs: f.specs.map((s, i) => (i === index ? { ...s, [key]: value } : s)),
    }));
  const removeSpec = (index: number) =>
    setForm((f) => ({ ...f, specs: f.specs.filter((_, i) => i !== index) }));

  const specsFull = form.specs.length >= MARKETPLACE_LIMITS.specs;

  // ─── Submit ─────────────────────────────────────────────────────
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const price = parseNumberField(form.price);
    if (price.invalid || price.value === null) {
      setError('Enter a valid selling price');
      return;
    }
    const mrp = parseNumberField(form.mrp);
    if (mrp.invalid) {
      setError('MRP must be a number, or leave it blank');
      return;
    }
    const stockQty = parseNumberField(form.stockQty);
    if (stockQty.invalid) {
      setError('Stock quantity must be a whole number, or leave it blank');
      return;
    }
    const displayOrder = parseNumberField(form.displayOrder);
    if (displayOrder.invalid) {
      setError('Display order must be a whole number');
      return;
    }
    // A pending size the admin typed but never confirmed with Enter.
    const pendingSizes = sizeDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const sizes = [...form.sizes];
    for (const s of pendingSizes) {
      if (!sizes.some((x) => x.toLowerCase() === s.toLowerCase())) sizes.push(s);
    }

    const parsed = ProductInputSchema.safeParse({
      name: form.name,
      category: form.category,
      brand: form.brand,
      sku: form.sku,
      description: form.description,
      price: price.value,
      mrp: mrp.value,
      stockQty: stockQty.value,
      inStock: form.inStock,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      displayOrder: displayOrder.value ?? 0,
      sizes,
      // Rows left completely blank are just unused; half-filled ones are
      // reported by the schema so a label never ships without a value.
      specs: form.specs.filter((s) => s.label.trim() || s.value.trim()),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Check the form and try again');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        product ? `/api/admin/shop/products/${product.id}` : '/api/admin/shop/products',
        {
          method: product ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't save product"));
      const saved = (await res.json()) as MarketplaceProductAdminView;
      if (product) toast.success('Product updated', saved.name);
      onSaved(saved, !product);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save product";
      setError(message);
      toast.error('Save failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ShopDialog
      title={product ? 'Edit product' : 'Add product'}
      subtitle={product ? product.name : 'Photos can be added right after saving'}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" form={formId} disabled={saving} className={primaryButtonClass}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : product ? 'Save changes' : 'Save product'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        <div>
          <label htmlFor={`${formId}-name`} className={labelClass}>
            Product name
          </label>
          <input
            id={`${formId}-name`}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={MARKETPLACE_LIMITS.name}
            placeholder="SS Ton Player Edition English Willow Bat"
            className={inputClass}
            disabled={saving}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor={`${formId}-category`} className={labelClass}>
            Category
          </label>
          <select
            id={`${formId}-category`}
            value={form.category}
            onChange={(e) =>
              set(
                'category',
                isMarketplaceCategory(e.target.value) ? e.target.value : MARKETPLACE_CATEGORY_IDS[0],
              )
            }
            className={inputClass}
            disabled={saving}
          >
            {MARKETPLACE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${formId}-brand`} className={labelClass}>
              Brand
            </label>
            <input
              id={`${formId}-brand`}
              value={form.brand}
              onChange={(e) => set('brand', e.target.value)}
              maxLength={MARKETPLACE_LIMITS.brand}
              placeholder="SS, SG, GM…"
              className={inputClass}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-sku`} className={labelClass}>
              SKU
            </label>
            <input
              id={`${formId}-sku`}
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              maxLength={MARKETPLACE_LIMITS.sku}
              placeholder="Optional"
              className={inputClass}
              disabled={saving}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${formId}-price`} className={labelClass}>
              Price (₹)
            </label>
            <input
              id={`${formId}-price`}
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="0"
              className={inputClass}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-mrp`} className={labelClass}>
              MRP (₹)
            </label>
            <input
              id={`${formId}-mrp`}
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              value={form.mrp}
              onChange={(e) => set('mrp', e.target.value)}
              placeholder="Optional"
              className={inputClass}
              disabled={saving}
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">
          An MRP above the price shows a strike-through and the % saving.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${formId}-stock`} className={labelClass}>
              Stock qty
            </label>
            <input
              id={`${formId}-stock`}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={form.stockQty}
              onChange={(e) => set('stockQty', e.target.value)}
              placeholder="Not tracked"
              className={inputClass}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-order`} className={labelClass}>
              Display order
            </label>
            <input
              id={`${formId}-order`}
              type="number"
              inputMode="numeric"
              step="1"
              value={form.displayOrder}
              onChange={(e) => set('displayOrder', e.target.value)}
              placeholder="0"
              className={inputClass}
              disabled={saving}
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">
          Blank stock means quantity isn&apos;t tracked. Lower display order lists first.
        </p>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 divide-y divide-white/[0.04]">
          <AdminToggle
            size="sm"
            enabled={form.inStock}
            onToggle={() => set('inStock', !form.inStock)}
            label="In stock"
            description="Off shows the product as sold out"
            disabled={saving}
          />
          <AdminToggle
            size="sm"
            enabled={form.isActive}
            onToggle={() => set('isActive', !form.isActive)}
            label="Published"
            description="Visible in the shop. Off keeps it hidden from customers."
            disabled={saving}
          />
          <AdminToggle
            size="sm"
            enabled={form.isFeatured}
            onToggle={() => set('isFeatured', !form.isFeatured)}
            label="Featured"
            description="Shown first, and on the landing page strip"
            disabled={saving}
          />
        </div>

        {/* Sizes — chip input: type, then Enter or a comma to add. */}
        <div>
          <label htmlFor={`${formId}-sizes`} className={labelClass}>
            Sizes{' '}
            <span className="text-slate-600 normal-case tracking-normal font-medium">
              ({form.sizes.length}/{MARKETPLACE_LIMITS.sizes})
            </span>
          </label>
          {form.sizes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.sizes.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent/10 border border-accent/20 text-accent pl-2.5 pr-1 py-1 text-xs font-semibold"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => removeSize(i)}
                    disabled={saving}
                    className="p-0.5 rounded hover:bg-accent/20 cursor-pointer disabled:opacity-50"
                    aria-label={`Remove size ${s}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            id={`${formId}-sizes`}
            value={sizeDraft}
            onChange={(e) => {
              setError(null);
              const v = e.target.value;
              if (v.includes(',')) addSizes(v);
              else setSizeDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSizes(sizeDraft);
              } else if (e.key === 'Backspace' && !sizeDraft && form.sizes.length > 0) {
                removeSize(form.sizes.length - 1);
              }
            }}
            onBlur={() => addSizes(sizeDraft)}
            maxLength={MARKETPLACE_LIMITS.sizeLabel}
            placeholder={sizesFull ? 'Size limit reached' : 'SH, Harrow, Size 6 — Enter or comma to add'}
            className={inputClass}
            disabled={saving || sizesFull}
          />
        </div>

        {/* Specs — label/value rows, rendered as a table on the product page. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`${labelClass} mb-0`}>
              Specifications{' '}
              <span className="text-slate-600 normal-case tracking-normal font-medium">
                ({form.specs.length}/{MARKETPLACE_LIMITS.specs})
              </span>
            </span>
            <button
              type="button"
              onClick={addSpec}
              disabled={saving || specsFull}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-light cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Add spec
            </button>
          </div>
          {form.specs.length === 0 ? (
            <p className="text-[11px] text-slate-500 rounded-lg border border-dashed border-white/[0.08] px-3 py-2.5">
              Willow grade, weight, handle type, warranty… Optional.
            </p>
          ) : (
            <div className="space-y-2">
              {form.specs.map((s, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-1.5 items-center">
                  <input
                    value={s.label}
                    onChange={(e) => updateSpec(i, 'label', e.target.value)}
                    maxLength={MARKETPLACE_LIMITS.specLabel}
                    placeholder="Weight"
                    aria-label={`Spec ${i + 1} label`}
                    className={inputClass}
                    disabled={saving}
                  />
                  <input
                    value={s.value}
                    onChange={(e) => updateSpec(i, 'value', e.target.value)}
                    maxLength={MARKETPLACE_LIMITS.specValue}
                    placeholder="1180 g"
                    aria-label={`Spec ${i + 1} value`}
                    className={inputClass}
                    disabled={saving}
                  />
                  <button
                    type="button"
                    onClick={() => removeSpec(i)}
                    disabled={saving}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 cursor-pointer disabled:opacity-50"
                    aria-label={`Remove spec ${i + 1}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor={`${formId}-description`} className={labelClass}>
            Description
          </label>
          <textarea
            id={`${formId}-description`}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            maxLength={MARKETPLACE_LIMITS.description}
            rows={4}
            placeholder="What makes this one worth it — grains, pick-up, who it suits."
            className={`${inputClass} min-h-[96px] resize-y`}
            disabled={saving}
          />
          <p className="text-right text-[11px] text-slate-500 tabular-nums mt-1">
            {form.description.length}/{MARKETPLACE_LIMITS.description}
          </p>
        </div>
      </form>
    </ShopDialog>
  );
}
