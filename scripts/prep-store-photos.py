#!/usr/bin/env python3
"""
Turn a supplier's photo dump into store-ready product shots.

The Cricket Store renders every photo in a 4:5 box with `object-cover`
(`ProductCard`, `ProductGallery`), so a portrait phone shot loses its
handle and toe to the crop and a landscape one loses the ends of the
bat. This normalises whatever arrives to exactly 4:5 with the product
inside it, matching the byte and dimension rules the browser uploader
applies (`src/lib/image-resize.ts`), and lays the results out as the
sku folders `seed-shop-products.ts --images` expects.

    python3 scripts/prep-store-photos.py --in ~/kis-raw --out ~/kis-assets --dry-run
    python3 scripts/prep-store-photos.py --in ~/kis-raw --out ~/kis-assets
    python3 scripts/prep-store-photos.py --in ~/kis-raw --out ~/kis-assets --cutout

Needs Pillow. `--cutout` additionally needs rembg, and HEIC input needs
pillow-heif:  pip install pillow rembg pillow-heif

`--in` holds one folder per product; the folder name is matched to the
catalog by sku or by product name, so "Game Changer Kashmir" finds
KIS-GC-KW. Sorting the photos into those folders is the one part a
person has to do — nothing in a supplier's filenames says which bat is
which.

What it does to each photo: applies EXIF rotation, optionally cuts the
product out and puts it on white (`--cutout`), pads to 4:5 without ever
cropping the product, normalises exposure, resizes to 1280x1600, encodes
JPEG stepping quality down until it fits the 3 MB server cap, and strips
all metadata (supplier phone photos carry GPS).

What it cannot do: invent detail. A photo whose subject is a few hundred
pixels across was shot or compressed too small to sell a bat with, and
upscaling it produces plausible-looking wood grain that is not the grain
of the bat being sold. Those are reported as TOO SMALL rather than
silently enlarged.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

try:  # iPhone photos arrive as HEIC often enough to be worth handling.
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIC = True
except Exception:  # pragma: no cover - optional dependency
    HEIC = False

# Mirrors src/lib/image-resize.ts so a CLI-prepared photo is
# indistinguishable from one the browser uploader produced.
MAX_DIMENSION = 1600
START_QUALITY = 85
MIN_QUALITY = 50
MAX_BYTES = 3 * 1024 * 1024
MIN_DIMENSION = 640

# The store's fixed display box (aspect-[4/5], object-cover).
DEFAULT_ASPECT = (4, 5)
# Share of the frame the product should fill after padding.
SUBJECT_FILL = 0.86
# Below this the source is too small to make a product shot from.
MIN_SUBJECT_LONG_EDGE = 700
# Below this it is usable but visibly soft at full width on desktop.
THIN_SUBJECT_LONG_EDGE = 1100

SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
WHITE = (255, 255, 255)


# ── catalog matching ────────────────────────────────────────────────


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


@dataclass
class CatalogEntry:
    sku: str
    name: str

    @property
    def tokens(self) -> set[str]:
        return set(_slug(self.name).split())


def load_catalog(path: Path | None) -> list[CatalogEntry]:
    if path is None:
        return []
    data = json.loads(path.read_text())
    return [CatalogEntry(sku=p["sku"], name=p.get("name", "")) for p in data.get("products", [])]


def match_sku(folder: str, catalog: list[CatalogEntry]) -> str | None:
    """
    Folder name -> sku. An exact sku wins; otherwise the catalog entry
    sharing the most words with the folder name, and only when that is a
    clear winner — a tie means the person named the folder ambiguously
    and should be told, not guessed at.
    """
    if not catalog:
        return folder
    want = _slug(folder)
    for entry in catalog:
        if want == _slug(entry.sku):
            return entry.sku
    want_tokens = set(want.split())
    if not want_tokens:
        return None
    scored = sorted(
        ((len(want_tokens & e.tokens), e) for e in catalog), key=lambda p: p[0], reverse=True
    )
    best, runner = scored[0], (scored[1] if len(scored) > 1 else (0, None))
    if best[0] >= 2 and best[0] > runner[0]:
        return best[1].sku
    return None


# ── image work ──────────────────────────────────────────────────────

_session = None


def cut_out(img: Image.Image) -> Image.Image:
    """Product on transparency, via rembg. Returns RGBA."""
    global _session
    from rembg import new_session, remove

    if _session is None:
        _session = new_session("u2net")
    return remove(img, session=_session).convert("RGBA")


def subject_box(img: Image.Image) -> tuple[int, int, int, int]:
    """
    The product's bounding box: the alpha channel's extent when the photo
    has been cut out, the whole frame otherwise (with no cutout there is
    nothing reliable enough to trim to, and a wrong guess crops a bat).
    """
    if img.mode == "RGBA":
        box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if box:
            return box
    return (0, 0, img.width, img.height)


def compose(img: Image.Image, aspect: tuple[int, int], fill: float) -> Image.Image:
    """
    Product centred on a white frame of the target aspect, scaled to fill
    `fill` of it. Never crops: the frame grows around the product.
    """
    box = subject_box(img)
    subject = img.crop(box)
    sw, sh = subject.size

    # Frame big enough to hold the subject at the requested fill share.
    aw, ah = aspect
    frame_w = max(sw / fill, (sh / fill) * aw / ah)
    frame_h = frame_w * ah / aw
    if frame_h < sh / fill:
        frame_h = sh / fill
        frame_w = frame_h * aw / ah
    frame_w, frame_h = int(round(frame_w)), int(round(frame_h))

    canvas = Image.new("RGB", (frame_w, frame_h), WHITE)
    offset = ((frame_w - sw) // 2, (frame_h - sh) // 2)
    if subject.mode == "RGBA":
        canvas.paste(subject, offset, subject)
    else:
        canvas.paste(subject.convert("RGB"), offset)
    return canvas


def normalise_exposure(img: Image.Image) -> Image.Image:
    """
    Gentle per-channel autocontrast. `cutoff=1` ignores the extreme 1% so
    a single blown highlight or dark speck cannot drag the whole frame,
    and `preserve_tone` keeps colours from shifting — a red grip must not
    turn orange because the background was grey.
    """
    return ImageOps.autocontrast(img, cutoff=1, preserve_tone=True)


def fit_exact(img: Image.Image, aspect: tuple[int, int], max_long: int) -> Image.Image:
    """
    Resize to *exactly* the target ratio, never upscaling.

    `thumbnail` preserves the source's own ratio, so a frame that rounded
    to 1338x1672 comes out 1280x1600-ish but not exactly 4:5 — and the
    store crops with `object-cover`, so "nearly" means a sliver of the
    bat is shaved off at some viewport widths. Snapping the long edge
    down to a multiple of the aspect's long term makes the division
    exact: 1600 = 5 x 320 gives 1280x1600 with no remainder.
    """
    aw, ah = aspect
    portrait = ah >= aw
    long_term, short_term = (ah, aw) if portrait else (aw, ah)
    current_long = img.height if portrait else img.width
    target_long = min(current_long, max_long)
    target_long -= target_long % long_term          # exact division
    target_long = max(target_long, long_term)
    target_short = target_long // long_term * short_term
    size = (target_short, target_long) if portrait else (target_long, target_short)
    return img.resize(size, Image.LANCZOS)


def encode(img: Image.Image, aspect: tuple[int, int]) -> tuple[bytes, int, int]:
    """
    JPEG under the server cap, stepping quality then dimensions down the
    way the browser uploader does. Metadata is dropped by construction —
    nothing is copied onto the new image.
    """
    long_edge = MAX_DIMENSION
    while True:
        work = fit_exact(img, aspect, long_edge)
        quality = START_QUALITY
        while quality >= MIN_QUALITY:
            buf = BytesIO()
            work.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
            if buf.tell() <= MAX_BYTES:
                return buf.getvalue(), work.width, work.height
            quality -= 10
        if long_edge <= MIN_DIMENSION:
            # Cannot happen for a 4:5 photo at these limits, but a caller
            # raising MAX_DIMENSION should get an error, not a silent 4 MB file.
            raise RuntimeError("cannot fit the byte cap above the minimum dimension")
        long_edge = max(MIN_DIMENSION, int(long_edge * 0.85))


# ── pipeline ────────────────────────────────────────────────────────


@dataclass
class Result:
    sku: str
    written: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def verdict(long_edge: int) -> str:
    if long_edge < MIN_SUBJECT_LONG_EDGE:
        return "TOO SMALL"
    if long_edge < THIN_SUBJECT_LONG_EDGE:
        return "soft"
    return "ok"


def process_folder(
    src: Path, sku: str, out_root: Path, args: argparse.Namespace
) -> Result:
    res = Result(sku=sku)
    photos = sorted(
        (p for p in src.iterdir() if p.is_file() and p.suffix.lower() in SUFFIXES),
        key=lambda p: (len(p.stem), p.name.lower()),
    )
    if not photos:
        res.warnings.append("no images in the folder")
        return res

    dest = out_root / sku
    if not args.dry_run:
        dest.mkdir(parents=True, exist_ok=True)

    index = 0
    for photo in photos:
        try:
            with Image.open(photo) as raw:
                img = ImageOps.exif_transpose(raw)
                img.load()
        except Exception as exc:
            res.warnings.append(f"{photo.name}: unreadable ({exc.__class__.__name__})")
            continue

        source_long = max(img.size)
        if args.cutout:
            try:
                img = cut_out(img.convert("RGB"))
            except Exception as exc:
                res.warnings.append(f"{photo.name}: cutout failed ({exc.__class__.__name__}), padded instead")

        box = subject_box(img)
        subject_long = max(box[2] - box[0], box[3] - box[1])
        # With no cutout the box is the whole frame, so say "photo",
        # not "product" — the number means something different.
        noun = "product" if args.cutout and img.mode == "RGBA" else "photo"
        state = verdict(subject_long)
        if state == "TOO SMALL":
            res.warnings.append(
                f"{photo.name}: {noun} is only {subject_long}px on the long edge "
                f"(source {source_long}px) — reshoot, no processing recovers this"
            )
            if not args.keep_small:
                continue
        elif state == "soft":
            res.warnings.append(
                f"{photo.name}: {noun} is {subject_long}px on the long edge — "
                "fine on cards, soft on the product page"
            )

        framed = compose(img, args.aspect, args.fill)
        if not args.no_levels:
            framed = normalise_exposure(framed)

        index += 1
        name = f"{index:02d}.jpg"
        try:
            data, w, h = encode(framed, args.aspect)
        except RuntimeError as exc:
            res.warnings.append(f"{photo.name}: {exc}")
            index -= 1
            continue
        if not args.dry_run:
            (dest / name).write_bytes(data)
        res.written.append(f"{name}  {w}x{h}  {len(data) // 1024} KB  [{state}]  <- {photo.name}")
        if index >= args.max_images:
            remaining = len(photos) - photos.index(photo) - 1
            if remaining > 0:
                res.warnings.append(f"{remaining} more photo(s) skipped — the store caps a product at {args.max_images}")
            break
    return res


def parse_aspect(text: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d+):(\d+)", text.strip())
    if not m:
        raise argparse.ArgumentTypeError("aspect must look like 4:5")
    return int(m.group(1)), int(m.group(2))


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Normalise supplier photos into store-ready sku folders.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--in", dest="src", required=True, type=Path, help="folder of per-product folders")
    ap.add_argument("--out", dest="out", required=True, type=Path, help="where the sku folders are written")
    ap.add_argument("--catalog", type=Path, default=None, help="catalog manifest used to resolve folder names to skus")
    ap.add_argument("--cutout", action="store_true", help="remove the background and place the product on white")
    ap.add_argument("--aspect", type=parse_aspect, default=DEFAULT_ASPECT, help="output aspect ratio")
    ap.add_argument("--fill", type=float, default=SUBJECT_FILL, help="share of the frame the product fills")
    ap.add_argument("--max-images", type=int, default=8, help="per-product cap, matching the store")
    ap.add_argument("--keep-small", action="store_true", help="write photos flagged TOO SMALL instead of skipping them")
    ap.add_argument("--no-levels", action="store_true", help="skip exposure normalisation")
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    args = ap.parse_args()

    if not args.src.is_dir():
        print(f"--in {args.src} is not a folder", file=sys.stderr)
        return 1
    if not 0.1 <= args.fill <= 1.0:
        print("--fill must be between 0.1 and 1.0", file=sys.stderr)
        return 1
    if args.cutout:
        # Fail here rather than per-photo: a run that silently padded
        # every shot because a dependency was missing looks like it worked.
        try:
            import rembg  # noqa: F401
        except ImportError:
            print("--cutout needs rembg:  pip install rembg", file=sys.stderr)
            return 1

    catalog = load_catalog(args.catalog) if args.catalog else []
    folders = sorted(p for p in args.src.iterdir() if p.is_dir())
    if not folders:
        print(f"--in {args.src} has no per-product folders", file=sys.stderr)
        return 1

    print(f"in:      {args.src}")
    print(f"out:     {args.out}")
    print(f"catalog: {args.catalog or '(none — folder names used as skus)'}")
    print(f"mode:    {'DRY RUN' if args.dry_run else 'WRITE'}"
          f"{', cutout' if args.cutout else ', pad only'}"
          f", {args.aspect[0]}:{args.aspect[1]}"
          f"{'' if HEIC else ', no HEIC support'}")
    print()

    unmatched: list[str] = []
    results: list[Result] = []
    for folder in folders:
        sku = match_sku(folder.name, catalog)
        if sku is None:
            unmatched.append(folder.name)
            continue
        results.append(process_folder(folder, sku, args.out, args))

    total = 0
    for res in results:
        print(f"{res.sku}")
        for line in res.written:
            print(f"    {line}")
        for warn in res.warnings:
            print(f"    ! {warn}")
        if not res.written:
            print("    (nothing written)")
        total += len(res.written)
        print()

    if unmatched:
        print("Folders that matched no catalog product — rename them to a sku:")
        for name in unmatched:
            print(f"    ? {name}")
        print()

    print(f"{total} photo(s) prepared across {len(results)} product(s).")
    if args.dry_run:
        print("Dry run — nothing written.")
    else:
        print(f"Load them with:  npx tsx scripts/seed-shop-products.ts "
              f"--manifest scripts/kis-catalog.json --images {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
