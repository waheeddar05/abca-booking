/**
 * Client-side image preparation for marketplace uploads.
 *
 * Product photos come straight off a phone camera (4–12 MB HEIC/JPEG).
 * The server caps uploads at `MARKETPLACE_LIMITS.maxImageBytes` and
 * stores the bytes in Postgres, so the browser downsizes first: longest
 * edge capped, EXIF orientation baked in, re-encoded as JPEG (or PNG when
 * the source is a PNG, to keep transparency). Typical output is 100–300 KB.
 *
 * The encoded size is checked against the server cap before returning.
 * A photographic PNG re-encoded losslessly can still land at 3–4 MB at
 * 1600px, so an oversized PNG falls back to JPEG, and an oversized JPEG
 * steps quality then dimensions down until it fits — the upload never
 * leaves the browser knowing it will be refused.
 *
 * Browser-only — uses canvas. Never import from a server module.
 */

import { MARKETPLACE_LIMITS } from '@/lib/marketplace';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  contentType: 'image/jpeg' | 'image/png';
}

export interface PrepareImageOptions {
  /** Longest edge after resize. */
  maxDimension?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
  /** Byte ceiling the result must fit under. Defaults to the server's cap. */
  maxBytes?: number;
}

const DEFAULTS: Required<PrepareImageOptions> = {
  maxDimension: 1600,
  quality: 0.85,
  maxBytes: MARKETPLACE_LIMITS.maxImageBytes,
};

/** Quality never goes below this — past it the photo stops being useful. */
const MIN_QUALITY = 0.5;
/** Dimension never goes below this — a product shot smaller than this is unusable. */
const MIN_DIMENSION = 640;

type Decoded = ImageBitmap | HTMLImageElement;

async function decode(file: File): Promise<Decoded> {
  // `imageOrientation: 'from-image'` applies the EXIF rotation so a
  // portrait phone shot doesn't land on its side.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the <img> path (older Safari, unusual formats).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image'));
      img.src = url;
    });
  } finally {
    // The <img> keeps its decoded pixels; the URL can go once loaded.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      type,
      quality,
    );
  });
}

function draw(source: Decoded, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available in this browser');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function fit(srcW: number, srcH: number, maxDimension: number): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

/** Downsize + re-encode a picked file so it is ready for the upload route. */
export async function prepareImageForUpload(
  file: File,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const { maxDimension, quality, maxBytes } = { ...DEFAULTS, ...options };
  const source = await decode(file);
  try {
    const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!srcW || !srcH) throw new Error('That file could not be read as an image');

    let dimension = maxDimension;
    let { width, height } = fit(srcW, srcH, dimension);
    let canvas = draw(source, width, height);

    // PNG keeps transparency for a PNG source; everything else is JPEG.
    let contentType: PreparedImage['contentType'] = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let q = quality;
    let blob = await toBlob(canvas, contentType, contentType === 'image/jpeg' ? q : undefined);

    // A lossless PNG of a photo can be several MB at 1600px. Transparency
    // is rare on a product shot and worthless against the store's dark
    // card background, so an oversized PNG becomes a JPEG.
    if (blob.size > maxBytes && contentType === 'image/png') {
      contentType = 'image/jpeg';
      blob = await toBlob(canvas, contentType, q);
    }

    // Still too big: trade quality first, then pixels, until it fits.
    while (blob.size > maxBytes && (q > MIN_QUALITY || dimension > MIN_DIMENSION)) {
      if (q > MIN_QUALITY) {
        q = Math.max(MIN_QUALITY, q - 0.15);
      } else {
        dimension = Math.max(MIN_DIMENSION, Math.round(dimension * 0.75));
        ({ width, height } = fit(srcW, srcH, dimension));
        canvas = draw(source, width, height);
      }
      blob = await toBlob(canvas, contentType, q);
    }

    if (blob.size > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`This image can’t be compressed under ${mb} MB — try a smaller photo`);
    }

    return { blob, width, height, contentType };
  } finally {
    if ('close' in source && typeof source.close === 'function') source.close();
  }
}
