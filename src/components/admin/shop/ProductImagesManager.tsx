'use client';

/**
 * Photos for one product: upload, reorder, pick the primary, delete.
 *
 * Uploads go one file per request, sequentially — the API takes a single
 * `file` — after `prepareImageForUpload` has downsized the phone shot in
 * the browser (a 10 MB camera JPEG becomes a few hundred KB). Order is
 * the array order; the first image is the primary one on every card, so
 * "Make primary" is just a move to the front followed by a reorder PATCH.
 *
 * Every mutation reports the fresh image list back through
 * `onImagesChanged` so the product list's thumbnails track it.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ProductImage } from '@/components/shop/ProductImage';
import { MARKETPLACE_LIMITS, type MarketplaceImageMeta, type MarketplaceProductAdminView } from '@/lib/marketplace';
import { prepareImageForUpload } from '@/lib/image-resize';
import { readApiError, secondaryButtonClass } from './common';
import { ShopDialog } from './ShopDialog';

interface Props {
  product: MarketplaceProductAdminView;
  onClose: () => void;
  onImagesChanged: (productId: string, images: MarketplaceImageMeta[]) => void;
}

const MAX = MARKETPLACE_LIMITS.maxImages;

const tileButtonClass =
  'p-1.5 rounded-md text-slate-300 hover:text-white bg-black/50 hover:bg-black/70 border border-white/[0.1] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export function ProductImagesManager({ product, onClose, onImagesChanged }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<MarketplaceImageMeta[]>(product.images);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  // Image id whose reorder / delete request is in flight.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MarketplaceImageMeta | null>(null);

  // Report every change upward. Done in an effect rather than at each
  // call site so the upload loop's partial progress reaches the list too.
  const reportedRef = useRef(product.images);
  useEffect(() => {
    if (reportedRef.current === images) return;
    reportedRef.current = images;
    onImagesChanged(product.id, images);
  }, [images, onImagesChanged, product.id]);

  const busy = uploading !== null || pendingId !== null;
  const full = images.length >= MAX;

  const reorder = async (order: string[], movedId: string) => {
    setPendingId(movedId);
    try {
      const res = await fetch(`/api/admin/shop/products/${product.id}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't reorder photos"));
      const json = (await res.json()) as { images: MarketplaceImageMeta[] };
      setImages(json.images);
    } catch (err) {
      toast.error('Reorder failed', err instanceof Error ? err.message : undefined);
    } finally {
      setPendingId(null);
    }
  };

  const makePrimary = (id: string) =>
    reorder([id, ...images.filter((i) => i.id !== id).map((i) => i.id)], id);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const ids = images.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder(ids, images[index].id);
  };

  const remove = async (image: MarketplaceImageMeta) => {
    setPendingId(image.id);
    try {
      const res = await fetch(`/api/admin/shop/products/${product.id}/images/${image.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readApiError(res, "Couldn't delete photo"));
      const json = (await res.json()) as { deleted: true; images: MarketplaceImageMeta[] };
      setImages(json.images);
      setConfirmDelete(null);
      toast.success('Photo removed');
    } catch (err) {
      setConfirmDelete(null);
      toast.error('Delete failed', err instanceof Error ? err.message : undefined);
    } finally {
      setPendingId(null);
    }
  };

  const upload = async (files: File[]) => {
    const room = MAX - images.length;
    if (room <= 0) {
      toast.info('Photo limit reached', `A product can have at most ${MAX} photos.`);
      return;
    }
    const queue = files.slice(0, room);
    if (files.length > room) {
      toast.info(
        `Only ${room} more photo${room === 1 ? '' : 's'} can be added`,
        `The first ${room} of ${files.length} selected will be uploaded.`,
      );
    }
    setUploading({ done: 0, total: queue.length });
    let count = images.length;
    let added = 0;
    for (let n = 0; n < queue.length; n++) {
      const file = queue[n];
      setUploading({ done: n, total: queue.length });
      try {
        const prepared = await prepareImageForUpload(file);
        const ext = prepared.contentType === 'image/png' ? 'png' : 'jpg';
        const body = new FormData();
        body.append('file', new File([prepared.blob], `${product.id}-${count + 1}.${ext}`, { type: prepared.contentType }));
        body.append('alt', `${product.name} photo ${count + 1}`);
        const res = await fetch(`/api/admin/shop/products/${product.id}/images`, { method: 'POST', body });
        if (!res.ok) throw new Error(await readApiError(res, 'Upload failed'));
        const meta = (await res.json()) as MarketplaceImageMeta;
        count += 1;
        added += 1;
        setImages((prev) => [...prev, meta]);
      } catch (err) {
        toast.error(`Couldn't upload ${file.name}`, err instanceof Error ? err.message : undefined);
      }
      if (count >= MAX && n < queue.length - 1) {
        toast.info('Photo limit reached', `Stopped at ${MAX} photos.`);
        break;
      }
    }
    setUploading(null);
    if (added > 0) toast.success(`${added} photo${added === 1 ? '' : 's'} added`);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so picking the same file again re-fires onChange.
    e.target.value = '';
    if (files.length > 0) void upload(files);
  };

  return (
    <>
      <ShopDialog
        title="Photos"
        subtitle={product.name}
        busy={busy}
        size="lg"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto text-xs text-slate-500 tabular-nums">
              {images.length} of {MAX}
            </span>
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>
              Done
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPick}
              disabled={busy || full}
              className="sr-only"
              aria-label="Add photos"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || full}
              className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-light text-primary font-bold rounded-xl px-4 py-2.5 text-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {uploading
                ? `Uploading ${Math.min(uploading.done + 1, uploading.total)} of ${uploading.total}`
                : full
                  ? `${MAX} of ${MAX}`
                  : 'Add photos'}
            </button>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {full
                ? 'Photo limit reached — remove one to add another.'
                : 'JPEG, PNG or WebP. Photos are resized in the browser before upload. The first photo is the one shown on the shop card.'}
            </p>
          </div>

          {images.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.1] px-4 py-10 text-center">
              <ImagePlus className="w-7 h-7 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No photos yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Products without a photo show a category placeholder in the shop.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((image, index) => {
                const isPending = pendingId === image.id;
                const isPrimary = index === 0;
                return (
                  <li
                    key={image.id}
                    className={`relative rounded-xl overflow-hidden border ${
                      isPrimary ? 'border-accent/40' : 'border-white/[0.08]'
                    }`}
                  >
                    <ProductImage
                      image={image}
                      category={product.category}
                      alt={image.alt || `${product.name} photo ${index + 1}`}
                      className="aspect-square w-full"
                      sizes="(max-width: 640px) 45vw, 200px"
                    />
                    {isPrimary && (
                      <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-accent/90 text-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        <Star className="w-2.5 h-2.5 fill-current" />
                        Primary
                      </span>
                    )}
                    {isPending && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 flex items-center justify-between gap-1 p-1.5 bg-gradient-to-t from-black/70 to-transparent">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={busy || index === 0}
                          className={tileButtonClass}
                          aria-label={`Move photo ${index + 1} left`}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={busy || index === images.length - 1}
                          className={tileButtonClass}
                          aria-label={`Move photo ${index + 1} right`}
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        {!isPrimary && (
                          <button
                            type="button"
                            onClick={() => makePrimary(image.id)}
                            disabled={busy}
                            className={tileButtonClass}
                            aria-label={`Make photo ${index + 1} the primary photo`}
                            title="Make primary"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(image)}
                        disabled={busy}
                        className={`${tileButtonClass} hover:text-red-300`}
                        aria-label={`Delete photo ${index + 1}`}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ShopDialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this photo?"
        message={
          confirmDelete && images[0]?.id === confirmDelete.id && images.length > 1
            ? 'This is the primary photo — the next one becomes primary.'
            : 'The photo is removed from the product and the shop immediately.'
        }
        warning="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={!!confirmDelete && pendingId === confirmDelete.id}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
