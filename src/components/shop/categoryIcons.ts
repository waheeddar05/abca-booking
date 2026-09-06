import {
  Backpack,
  CircleDot,
  Footprints,
  Hand,
  HardHat,
  Package,
  Shield,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { MARKETPLACE_CATEGORIES } from '@/lib/marketplace';

/**
 * One icon per store category — the image placeholder on a product with
 * no photo yet and the tiles of the landing-page teaser. Lucide has no
 * cricket bat, so BAT uses the sparkle "new gear" glyph rather than a
 * baseball bat that reads as the wrong sport.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  BAT: Sparkles,
  GLOVES: Hand,
  THIGH_GUARD: Shield,
  PADS: ShieldCheck,
  HELMET: HardHat,
  PROTECTION: Shield,
  BALL: CircleDot,
  KIT_BAG: Backpack,
  SHOES: Footprints,
  ACCESSORY: Package,
};

export function categoryIcon(category: string | null | undefined): LucideIcon {
  return (category && CATEGORY_ICONS[category]) || Package;
}

/** Fallback glyph for a category with no icon of its own. */
export const DEFAULT_CATEGORY_ICON: LucideIcon = Package;

/** The catalog with icons attached, for teaser grids. */
export const CATEGORY_TILES = MARKETPLACE_CATEGORIES.map((c) => ({
  ...c,
  icon: categoryIcon(c.value),
}));
