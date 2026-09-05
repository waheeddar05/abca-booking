/**
 * Client-side image preparation for marketplace uploads.
 *
 * Product photos come straight off a phone camera (4–12 MB HEIC/JPEG).
 * The server caps uploads at 3 MB and stores the bytes in Postgres, so
 * the browser downsizes first: longest edge capped, EXIF orientation
 * baked in, re-encoded as JPEG (or PNG when the source is a PNG, to keep
 * transparency). Typical output is 100–300 KB.
 *
 * Browser-only — uses canvas. Never import from a server module.
 */

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
}

const DEFAULTS: Required<PrepareImageOptions> = { maxDimension: 1600, quality: 0.85 };

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
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

/** Downsize + re-encode a picked file so it is ready for the upload route. */
export async function prepareImageForUpload(
  file: File,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const { maxDimension, quality } = { ...DEFAULTS, ...options };
  const source = await decode(file);
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!srcW || !srcH) throw new Error('That file could not be read as an image');

  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not available in this browser');
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();

  const contentType: PreparedImage['contentType'] =
    file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await toBlob(canvas, contentType, contentType === 'image/jpeg' ? quality : undefined);
  return { blob, width, height, contentType };
}
