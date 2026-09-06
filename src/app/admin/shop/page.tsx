'use client';

/**
 * Admin → Cricket Store.
 *
 * The store's back office — one catalog for all of PlayOrbit, not a
 * center's: launch settings (enabled / coming soon / launch note /
 * pickup location / WhatsApp number) and the product catalog — create,
 * edit, photos, publish and feature toggles, delete, and the "Notify me"
 * interest list per product.
 *
 * Store admins (`User.isStoreAdmin`) and super admins only. The
 * middleware and every `/api/admin/shop/*` route enforce it; the check
 * here is a courtesy notice for anyone who reaches the page otherwise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Plus, Search, ShieldAlert, Store, X } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { MarketplaceSettingsCard } from '@/components/admin/shop/MarketplaceSettingsCard';
import { ProductFormDialog } from '@/components/admin/shop/ProductFormDialog';
import { ProductImagesManager } from '@/components/admin/shop/ProductImagesManager';
import { ProductInterestsDialog } from '@/components/admin/shop/ProductInterestsDialog';
import { ProductRow } from '@/components/admin/shop/ProductRow';
import { productToInput, readApiError } from '@/components/admin/shop/common';
import type { AdminProductsResponse, ProductStatusFilter } from '@/components/admin/shop/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { useToast } from '@/components/ui/Toast';
import {
  MARKETPLACE_CATEGORIES,
  SHOP_PATH,
  STORE_NAME,
  isMarketplaceCategory,
  type MarketplaceImageMeta,
  type MarketplaceProductAdminView,
  type ProductInput,
} from '@/lib/marketplace';
import { invalidateMarketplaceStatus } from '@/lib/marketplace-status';
import { useAdminRole } from '@/lib/useAdminRole';

const controlClass =
  'w-full bg-slate-900/50 border border-white/[0.1] text-white placeholder:text-slate-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 [color-scheme:dark]';
const filterLabelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 ml-0.5';

const STATUS_OPTIONS: Array<{ value: ProductStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Published' },
  { value: 'inactive', label: 'Hidden' },
];

export default function AdminShopPage() {
  const { canManageStore, loading: roleLoading } = useAdminRole();
  const toast = useToast();

  // ─── Filters ────────────────────────────────────────────────────
  const [status, setStatus] = useState<ProductStatusFilter>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ status });
    if (category) params.set('category', category);
    if (debouncedSearch) params.set('q', debouncedSearch);
    return params.toString();
  }, [status, category, debouncedSearch]);

  // ─── Data ───────────────────────────────────────────────────────
  const [data, setData] = useState<AdminProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (roleLoading || !canManageStore) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/shop/products?${queryString}`, { signal: controller.signal });
        if (!res.ok) throw new Error(await readApiError(res, "Couldn't load products"));
        setData((await res.json()) as AdminProductsResponse);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : "Couldn't load products");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [queryString, reloadKey, roleLoading, canManageStore]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // ─── Dialogs ────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MarketplaceProductAdminView | null>(null);
  const [photosFor, setPhotosFor] = useState<MarketplaceProductAdminView | null>(null);
  const [interestsFor, setInterestsFor] = useState<MarketplaceProductAdminView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MarketplaceProductAdminView | null>(null);
  // Product id with a publish / feature / delete request in flight.
  const [busyId, setBusyId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (product: MarketplaceProductAdminView) => {
    setEditing(product);
    setFormOpen(true);
  };
  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditing(null);
  }, []);
  const closePhotos = useCallback(() => setPhotosFor(null), []);
  const closeInterests = useCallback(() => setInterestsFor(null), []);

  // ─── Row-level updates ──────────────────────────────────────────
  /** Replace one row in place, keeping the center-wide totals in step. */
  const replaceProduct = useCallback((next: MarketplaceProductAdminView) => {
    setData((d) => {
      if (!d) return d;
      const prev = d.products.find((p) => p.id === next.id);
      const totals = { ...d.totals };
      if (prev && prev.isActive !== next.isActive) {
        totals.active += next.isActive ? 1 : -1;
        totals.inactive += next.isActive ? -1 : 1;
      }
      return { ...d, totals, products: d.products.map((p) => (p.id === next.id ? next : p)) };
    });
  }, []);

  const onImagesChanged = useCallback((productId: string, images: MarketplaceImageMeta[]) => {
    setData((d) =>
      d
        ? {
            ...d,
            products: d.products.map((p) =>
              p.id === productId ? { ...p, images, primaryImage: images[0] ?? null } : p,
            ),
          }
        : d,
    );
    // The photos dialog holds its own copy; keep the header's product
    // fresh so a re-open after a list refresh starts from the right list.
    setPhotosFor((p) => (p && p.id === productId ? { ...p, images, primaryImage: images[0] ?? null } : p));
  }, []);

  // The API takes the complete product on PATCH, so a quick toggle sends
  // the whole row with the one flag flipped.
  const patchProduct = async (product: MarketplaceProductAdminView, patch: Partial<ProductInput>, label: string) => {
    setBusyId(product.id);
    try {
      const res = await fetch(`/api/admin/shop/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...productToInput(product), ...patch }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Update failed'));
      const updated = (await res.json()) as MarketplaceProductAdminView;
      replaceProduct(updated);
      invalidateMarketplaceStatus();
      toast.success(label, updated.name);
    } catch (err) {
      toast.error(`${label} failed`, err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const togglePublished = (product: MarketplaceProductAdminView) =>
    patchProduct(product, { isActive: !product.isActive }, product.isActive ? 'Product hidden' : 'Product published');

  const toggleFeatured = (product: MarketplaceProductAdminView) =>
    patchProduct(product, { isFeatured: !product.isFeatured }, product.isFeatured ? 'Removed from featured' : 'Marked as featured');

  const remove = async (product: MarketplaceProductAdminView) => {
    setBusyId(product.id);
    try {
      const res = await fetch(`/api/admin/shop/products/${product.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't delete product"));
      setData((d) =>
        d
          ? {
              ...d,
              products: d.products.filter((p) => p.id !== product.id),
              totals: {
                active: d.totals.active - (product.isActive ? 1 : 0),
                inactive: d.totals.inactive - (product.isActive ? 0 : 1),
              },
            }
          : d,
      );
      invalidateMarketplaceStatus();
      toast.success('Product deleted', product.name);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : undefined);
    } finally {
      setConfirmDelete(null);
      setBusyId(null);
    }
  };

  const onSaved = (product: MarketplaceProductAdminView, created: boolean) => {
    closeForm();
    invalidateMarketplaceStatus();
    // The list is re-fetched rather than patched: a save can change the
    // sort position or drop the row out of the current filter.
    refresh();
    if (created) {
      toast.success('Product saved — add photos', product.name);
      setPhotosFor(product);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────
  if (roleLoading) return <LoadingState message="Loading…" />;

  if (!canManageStore) {
    return (
      <div className="space-y-4 pb-10">
        <AdminPageHeader icon={Store} title={STORE_NAME} description="Bats, gloves & gear sold through the app" />
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            The Cricket Store is run by store admins. Ask a super admin to grant you store access.
          </p>
        </div>
      </div>
    );
  }

  const products = data?.products ?? [];
  const filtersDirty = status !== 'all' || !!category || !!search;
  const resetFilters = () => {
    setStatus('all');
    setCategory('');
    setSearch('');
  };

  return (
    <div className="space-y-4 pb-10">
      <AdminPageHeader
        icon={Store}
        title={STORE_NAME}
        description="Bats, gloves & gear sold through the app — one store for all of PlayOrbit"
      >
        <Link
          href={SHOP_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-white/[0.05] border border-white/[0.05] transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View shop
        </Link>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-900 bg-accent hover:brightness-110 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add product
        </button>
      </AdminPageHeader>

      <MarketplaceSettingsCard />

      {/* Products */}
      <section className="space-y-3" aria-labelledby="shop-products-heading">
        <div className="flex items-baseline justify-between gap-3 px-0.5">
          <h2 id="shop-products-heading" className="text-sm font-bold text-white uppercase tracking-wider">
            Products
          </h2>
          {data && (
            <p className="text-xs text-slate-400 tabular-nums">
              {data.totals.active} published · {data.totals.inactive} hidden
            </p>
          )}
        </div>

        <div className="bg-white/[0.03] backdrop-blur-sm rounded-xl border border-white/[0.07] p-3.5 sm:p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shop-filter-status" className={filterLabelClass}>
                Status
              </label>
              <select
                id="shop-filter-status"
                value={status}
                onChange={(e) => {
                  const v = e.target.value;
                  setStatus(v === 'active' || v === 'inactive' ? v : 'all');
                }}
                className={controlClass}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="shop-filter-category" className={filterLabelClass}>
                Category
              </label>
              <select
                id="shop-filter-category"
                value={category}
                onChange={(e) => setCategory(isMarketplaceCategory(e.target.value) ? e.target.value : '')}
                className={controlClass}
              >
                <option value="">All categories</option>
                {MARKETPLACE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, brand or SKU…"
                aria-label="Search products"
                className={`${controlClass} pl-9`}
              />
            </div>
            {filtersDirty && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white px-3 py-2 bg-white/[0.05] rounded-lg border border-white/[0.05] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </div>

        {error && !loading ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : loading && !data ? (
          <ul className="space-y-3" aria-busy="true">
            {[...Array(3)].map((_, i) => (
              <li
                key={i}
                className="bg-white/[0.04] rounded-xl border border-white/[0.08] p-3.5 animate-pulse"
              >
                <div className="flex gap-3">
                  <div className="w-14 h-14 rounded-lg bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-2/3 bg-white/10 rounded" />
                    <div className="h-3 w-1/3 bg-white/5 rounded" />
                    <div className="h-3.5 w-16 bg-white/10 rounded" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : products.length === 0 ? (
          filtersDirty ? (
            <EmptyState
              icon={Search}
              title="No products match these filters"
              description="Try another category or clear the search."
              action={{ label: 'Reset filters', onClick: resetFilters }}
              className="py-12"
            />
          ) : (
            <EmptyState
              icon={Store}
              title="No products yet"
              description="Add your first bat, pair of gloves or kit bag. Products stay hidden until you publish them."
              action={{ label: 'Add product', onClick: openCreate }}
              className="py-12"
            />
          )
        ) : (
          <ul className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {products.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                busy={busyId === p.id}
                onEdit={() => openEdit(p)}
                onPhotos={() => setPhotosFor(p)}
                onTogglePublished={() => togglePublished(p)}
                onToggleFeatured={() => toggleFeatured(p)}
                onDelete={() => setConfirmDelete(p)}
                onShowInterests={() => setInterestsFor(p)}
              />
            ))}
          </ul>
        )}
      </section>

      {formOpen && <ProductFormDialog product={editing} onClose={closeForm} onSaved={onSaved} />}

      {photosFor && (
        <ProductImagesManager product={photosFor} onClose={closePhotos} onImagesChanged={onImagesChanged} />
      )}

      {interestsFor && <ProductInterestsDialog product={interestsFor} onClose={closeInterests} />}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete product?"
        message={confirmDelete ? `"${confirmDelete.name}" is removed from the store immediately.` : ''}
        warning={
          confirmDelete
            ? `Its ${confirmDelete.images.length} photo${confirmDelete.images.length === 1 ? '' : 's'} and the list of ${
                confirmDelete.interestCount
              } interested customer${confirmDelete.interestCount === 1 ? '' : 's'} are deleted with it. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="danger"
        loading={!!confirmDelete && busyId === confirmDelete.id}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
